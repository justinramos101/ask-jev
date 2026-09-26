#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const PROVIDERS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', keyEnv: 'TYPESAFE_API_KEY', model: 'jev-latest' },
  vercel: { url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', keyEnv: 'AI_GATEWAY_API_KEY', model: 'typesafe-ai/jev' },
};

const MAX_CANDIDATES = 300;
const MAX_FILE_BYTES = 200 * 1024;
const EXCERPT_CHARS = 2400;
const STATE_TOKEN_BUDGET = 24_000;
const CHARS_PER_TOKEN = 3.5;
const MAX_RATE_LIMIT_WAIT_MS = 90_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 30_000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'deno.lock', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'uv.lock', 'composer.lock',
  'go.sum', 'flake.lock', 'mix.lock', 'pubspec.lock', 'Podfile.lock', 'packages.lock.json',
]);
const STATE_CONTEXT =
  'A coding assistant is choosing which files to read for the goal below. Each entry in `files` is one candidate: its path and the start of its content, with indentation stripped. Each question asks whether the assistant must read that file to accomplish the goal.';

const USAGE = `Usage: node ask-jev.mjs files --goal "<goal>" [--top 8] [--min 0.3] [--provider auto|typesafe|vercel] <path|dir|glob>...`;

class InputError extends Error {
  constructor(message, showUsage = false) {
    super(message);
    this.showUsage = showUsage;
  }
}

export async function main(argv, io) {
  const started = io.now();
  try {
    const args = parseCli(argv);
    const access = pickProvider(args.provider, io.env);
    const { files, skipped } = collectFiles(args.targets, io.cwd);
    const batches = packBatches(files, args.goal);
    const scores = [];
    for (const batch of batches) scores.push(...(await askBatch(batch, args.goal, access, io)));
    scores.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const seconds = ((io.now() - started) / 1000).toFixed(1);
    const skippedNote = skipped > 0 ? ` (skipped ${skipped} binary, lock or oversized)` : '';
    const lines = [`Scored ${count(files.length, 'file')}${skippedNote} in ${count(batches.length, 'request')}, ${seconds} s.`];
    const qualified = scores.filter((s) => s.score >= args.min).slice(0, args.top);
    if (qualified.length > 0) {
      lines.push(...qualified.map(formatScore));
    } else {
      lines.push(`No file scored ${args.min.toFixed(2)} or higher. Best 3:`, ...scores.slice(0, 3).map(formatScore));
    }
    io.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`ask-jev: ${error.message}\n`);
    if (error.showUsage) io.stderr.write(`${USAGE}\n`);
    return error instanceof InputError ? 2 : 1;
  }
}

function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function formatScore({ score, path }) {
  return `${score.toFixed(2)}  ${path}`;
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        goal: { type: 'string' },
        top: { type: 'string', default: '8' },
        min: { type: 'string', default: '0.3' },
        provider: { type: 'string', default: 'auto' },
      },
    });
  } catch (error) {
    throw new InputError(error.message, true);
  }
  const [command, ...targets] = parsed.positionals;
  const { goal, provider } = parsed.values;
  const top = Number(parsed.values.top);
  const min = Number(parsed.values.min);
  if (command !== 'files') throw new InputError(`unknown command ${command ?? '(none)'}`, true);
  if (!goal?.trim()) throw new InputError('--goal is required', true);
  if (targets.length === 0) throw new InputError('pass at least one path, directory or glob', true);
  if (!Number.isInteger(top) || top < 1) throw new InputError('--top must be a positive integer', true);
  if (!(min >= 0 && min <= 1)) throw new InputError('--min must be between 0 and 1', true);
  if (provider !== 'auto' && !Object.hasOwn(PROVIDERS, provider)) throw new InputError(`unknown provider ${provider}`, true);
  return { goal: goal.trim(), top, min, provider, targets };
}

function pickProvider(choice, env) {
  const order = choice === 'auto' ? ['typesafe', 'vercel'] : [choice];
  for (const name of order) {
    const apiKey = env[PROVIDERS[name].keyEnv];
    if (apiKey) return { ...PROVIDERS[name], apiKey };
  }
  throw new InputError(`set ${order.map((name) => PROVIDERS[name].keyEnv).join(' or ')}`);
}

function collectFiles(targets, cwd) {
  const paths = new Set(expandTargets(targets, cwd));
  const sized = [];
  let skipped = 0;
  for (const path of paths) {
    const size = fileSize(resolve(cwd, path));
    if (size === undefined) continue;
    if (size > MAX_FILE_BYTES || LOCKFILES.has(basename(path))) skipped++;
    else sized.push(path);
  }
  if (sized.length > MAX_CANDIDATES) {
    throw new InputError(
      `${sized.length} candidate files; ask-jev scores at most ${MAX_CANDIDATES}. Narrow the paths: a subdirectory, a glob such as 'src/**/*.ts', or the files from rg -l <term>.`,
    );
  }
  const files = [];
  for (const path of sized) {
    const text = readText(resolve(cwd, path));
    if (text === undefined) skipped++;
    else files.push({ path, ...excerptOf(text) });
  }
  if (files.length === 0) throw new InputError('no readable text files among the candidates');
  return { files, skipped };
}

function isGitWorkTree(cwd) {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

// Everything that is not an existing file goes to one git ls-files call, so
// exclude pathspecs such as ':!*.test.ts' apply to the other targets.
function expandTargets(targets, cwd) {
  const files = [];
  const rest = [];
  for (const target of targets) {
    const absolute = resolve(cwd, target);
    if (existsSync(absolute) && statSync(absolute).isFile()) files.push(relative(cwd, absolute));
    else rest.push(target);
  }
  if (rest.length === 0) return files;
  if (isGitWorkTree(cwd)) {
    const listed = git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...rest]);
    return [...files, ...listed.split('\0').filter(Boolean)];
  }
  for (const target of rest) {
    const absolute = resolve(cwd, target);
    if (existsSync(absolute)) files.push(...walk(absolute).map((path) => relative(cwd, path)));
    else files.push(...globWalk(target, cwd));
  }
  return files;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function globWalk(pattern, cwd) {
  const segments = pattern.split('/');
  const firstGlob = segments.findIndex((segment) => /[*?[]/.test(segment));
  if (firstGlob === -1) return [];
  const root = resolve(cwd, segments.slice(0, firstGlob).join('/') || '.');
  if (!existsSync(root)) return [];
  const matcher = globToRegExp(resolve(cwd, pattern));
  return walk(root)
    .filter((path) => matcher.test(path))
    .map((path) => relative(cwd, path));
}

function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${sep === '/' ? source : source.replaceAll('/', '[\\\\/]')}$`);
}

function fileSize(path) {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

function readText(path) {
  const probe = Buffer.alloc(8000);
  const fd = openSync(path, 'r');
  const read = readSync(fd, probe, 0, probe.length, 0);
  closeSync(fd);
  if (probe.subarray(0, read).includes(0)) return undefined;
  return readFileSync(path, 'utf8');
}

function excerptOf(text) {
  const lines = text.split('\n').length;
  const compact = text
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  const truncated = compact.length > EXCERPT_CHARS;
  return { lines, excerpt: truncated ? `${compact.slice(0, EXCERPT_CHARS)}\n[truncated]` : compact };
}

function stateFor(entries, goal) {
  return { context: STATE_CONTEXT, goal, files: entries };
}

function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
}

function packBatches(files, goal) {
  const batches = [];
  let current = [];
  files.forEach((file, index) => {
    const entry = { id: `f${index + 1}`, path: file.path, lines: file.lines, excerpt: file.excerpt };
    if (current.length > 0 && estimateTokens(stateFor([...current, entry], goal)) > STATE_TOKEN_BUDGET) {
      batches.push(current);
      current = [];
    }
    current.push(entry);
  });
  if (current.length > 0) batches.push(current);
  return batches;
}

async function askBatch(entries, goal, access, io) {
  const questions = Object.fromEntries(
    entries.map((entry) => [
      entry.id,
      {
        type: 'noul',
        instructions: `File ${entry.id} (${entry.path}) contains code or text the assistant must read to accomplish the goal.`,
      },
    ]),
  );
  const body = JSON.stringify({ model: access.model, state: stateFor(entries, goal), questions });
  const response = await postWithRetry(access, body, io);
  const answers = response.answers ?? {};
  return entries.map((entry) => {
    const score = answers[entry.id]?.noul;
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error(`Jev returned no score for ${entry.path}`);
    return { path: entry.path, score };
  });
}

async function postWithRetry(access, body, io) {
  let waited = 0;
  for (;;) {
    const response = await io.fetch(access.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${access.apiKey}`, 'content-type': 'application/json' },
      body,
    });
    if (response.status === 429) {
      const waitMs = rateLimitWaitMs(response.headers);
      if (waited + waitMs > MAX_RATE_LIMIT_WAIT_MS) {
        throw new Error(`Jev is rate limited for another ${Math.ceil(waitMs / 1000)} s; gave up after waiting ${Math.round(waited / 1000)} s. Try again later.`);
      }
      io.stderr.write(`ask-jev: rate limited, waiting ${Math.ceil(waitMs / 1000)} s\n`);
      await io.sleep(waitMs);
      waited += waitMs;
      continue;
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`Jev request failed (${response.status}): ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Jev returned malformed JSON');
    }
  }
}

function rateLimitWaitMs(headers) {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = headers.get('x-ratelimit-reset-requests')?.trim();
  return (reset && durationMs(reset)) || DEFAULT_RATE_LIMIT_WAIT_MS;
}

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

function durationMs(value) {
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== value) return undefined;
  return parts.reduce((sum, [, amount, unit]) => sum + Number(amount) * UNIT_MS[unit], 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
