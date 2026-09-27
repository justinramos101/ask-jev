#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const PROVIDERS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', keyEnv: 'TYPESAFE_API_KEY', model: 'jev-latest' },
  vercel: {
    url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', keyEnv: 'AI_GATEWAY_API_KEY', model: 'typesafe-ai/jev',
    providerOptions: { gateway: { only: ['typesafe-ai'] } },
  },
};

const MAX_CANDIDATES = 300;
const MAX_FILE_BYTES = 200 * 1024;
const EXCERPT_CHARS = 2400;
const STATE_TOKEN_BUDGET = 24_000;
const CHARS_PER_TOKEN = 3.5;
const MAX_RATE_LIMIT_WAIT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'deno.lock', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'uv.lock', 'composer.lock',
  'go.sum', 'flake.lock', 'mix.lock', 'pubspec.lock', 'Podfile.lock', 'packages.lock.json',
]);
const STATE_CONTEXT =
  'A coding assistant is choosing which files to read for the goal below. Each entry in `files` is one candidate: its path and the start of its content, with indentation stripped. Each question asks whether the assistant must read that file to accomplish the goal.';

const USAGE = `Usage: node ask-jev.mjs ask <request.json|-> [--provider auto|typesafe|vercel] [--max-retries 0..5]
       node ask-jev.mjs files --goal "<goal>" [--top 8] [--min 0.3] [--provider auto|typesafe|vercel] [--max-retries 0..5] <path|dir|glob>...`;

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
    if (args.command === 'help') {
      io.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (args.command === 'ask') {
      const request = await readRequest(args.source, io);
      const result = await ask(request, pickProvider(args.provider, io.env), io, args.maxRetries);
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    const access = pickProvider(args.provider, io.env);
    const { files, skipped } = collectFiles(args.targets, io.cwd);
    const batches = packBatches(files, args.goal);
    const scores = [];
    for (const batch of batches) scores.push(...(await askBatch(batch, args.goal, access, io, args.maxRetries)));
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
        top: { type: 'string' },
        min: { type: 'string' },
        help: { type: 'boolean' },
        provider: { type: 'string', default: 'auto' },
        'max-retries': { type: 'string', default: String(DEFAULT_MAX_RETRIES) },
      },
    });
  } catch (error) {
    throw new InputError(error.message, true);
  }
  const [command, ...targets] = parsed.positionals;
  const { goal, provider } = parsed.values;
  if (parsed.values.help) return { command: 'help' };
  if (provider !== 'auto' && !Object.hasOwn(PROVIDERS, provider)) throw new InputError(`unknown provider ${provider}`, true);
  const maxRetries = Number(parsed.values['max-retries']);
  if (!/^\d+$/.test(parsed.values['max-retries']) || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new InputError('--max-retries must be an integer from 0 to 5', true);
  }
  if (command === 'ask') {
    for (const flag of ['goal', 'top', 'min']) {
      if (Object.hasOwn(parsed.values, flag)) throw new InputError(`--${flag} is only supported by files`, true);
    }
    if (targets.length !== 1) throw new InputError('ask requires one JSON path or - for stdin', true);
    return { command, source: targets[0], provider, maxRetries };
  }
  const top = Number(parsed.values.top ?? '8');
  const min = Number(parsed.values.min ?? '0.3');
  if (command !== 'files') throw new InputError(`unknown command ${command ?? '(none)'}`, true);
  if (!goal?.trim()) throw new InputError('--goal is required', true);
  if (targets.length === 0) throw new InputError('pass at least one path, directory or glob', true);
  if (!Number.isInteger(top) || top < 1) throw new InputError('--top must be a positive integer', true);
  if (!(min >= 0 && min <= 1)) throw new InputError('--min must be between 0 and 1', true);
  return { command, goal: goal.trim(), top, min, provider, maxRetries, targets };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isContent(value) {
  return typeof value === 'string' || isObject(value) || Array.isArray(value);
}

function onlyFields(value, fields, label) {
  if (!isObject(value)) throw new InputError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new InputError(`${label} has unknown field ${key}`);
  }
}

async function readRequest(source, io) {
  let request;
  try {
    const text = io.readInput
      ? await io.readInput(source)
      : readFileSync(source === '-' ? 0 : resolve(io.cwd, source), 'utf8');
    request = JSON.parse(text);
  } catch (error) {
    throw new InputError(`cannot read JSON request from ${source}: ${error.message}`);
  }
  onlyFields(request, ['state', 'questions'], 'request');
  if (!isContent(request.state)) throw new InputError('state must be a string, object, or array');
  if (!isObject(request.questions) || Object.keys(request.questions).length === 0) {
    throw new InputError('questions must be a nonempty object');
  }
  for (const [id, question] of Object.entries(request.questions)) {
    const label = `question ${JSON.stringify(id)}`;
    onlyFields(question, ['type', 'instructions', 'criteria'], label);
    if (!isContent(question.instructions)) throw new InputError(`${label} instructions must be a string, object, or array`);
    const criteria = question.criteria;
    if (question.type === 'choice') {
      if (!isObject(criteria) || Object.keys(criteria).length < 1 || Object.keys(criteria).length > 255 ||
          !Object.values(criteria).every((value) => value === null || isContent(value))) {
        throw new InputError(`${label} choice criteria must contain 1..255 options with string, object, array, or null descriptions`);
      }
    } else if (question.type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10 || !criteria.every(isContent)) {
        throw new InputError(`${label} score criteria must contain 2..10 string, object, or array descriptions`);
      }
    } else if (question.type === 'noul') {
      if (Object.hasOwn(question, 'criteria')) {
        onlyFields(criteria, ['true', 'false'], `${label} criteria`);
        if (!Object.values(criteria).every(isContent)) throw new InputError(`${label} noul criteria descriptions must be strings, objects, or arrays`);
      }
    } else {
      throw new InputError(`${label} type must be choice, score, or noul`);
    }
  }
  return request;
}

function inRange(value, maximum = 1) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

async function ask(request, access, io, maxRetries) {
  const body = { model: access.model, ...request };
  if (access.providerOptions) body.providerOptions = access.providerOptions;
  const response = await postWithRetry(access, JSON.stringify(body), io, maxRetries);
  if (!isObject(response) || !isObject(response.answers)) throw new Error('Jev returned no answers object');
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = Object.hasOwn(response.answers, id) ? response.answers[id] : undefined;
    const invalid = (field) => new Error(`Jev returned invalid ${field} for question ${JSON.stringify(id)}`);
    if (!isObject(answer) || answer.type !== question.type) throw invalid('answer type');
    if (question.type === 'noul') {
      if (!inRange(answer.noul)) throw invalid('noul');
      continue;
    }
    if (question.type === 'choice' && (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice))) throw invalid('choice');
    if (question.type === 'score' && !inRange(answer.score, question.criteria.length - 1)) throw invalid('score');
    if (!inRange(answer.confidence)) throw invalid('confidence');
    const keys = Object.keys(question.criteria);
    if (!isObject(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(answer.probabilities, key) && inRange(answer.probabilities[key]))) {
      throw invalid('probabilities');
    }
  }
  return response;
}

function pickProvider(choice, env) {
  const order = choice === 'auto' ? ['typesafe', 'vercel'] : [choice];
  for (const name of order) {
    const apiKey = env[PROVIDERS[name].keyEnv];
    if (apiKey) return { ...PROVIDERS[name], apiKey };
  }
  throw new InputError(`no API key, so Jev was not called. Set ${order.map((name) => PROVIDERS[name].keyEnv).join(' or ')} in the environment that starts the agent.`);
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

async function askBatch(entries, goal, access, io, maxRetries) {
  const questions = Object.fromEntries(
    entries.map((entry) => [
      entry.id,
      {
        type: 'noul',
        instructions: `File ${entry.id} (${entry.path}) contains code or text the assistant must read to accomplish the goal.`,
      },
    ]),
  );
  const response = await ask({ state: stateFor(entries, goal), questions }, access, io, maxRetries);
  return entries.map((entry) => ({ path: entry.path, score: response.answers[entry.id].noul }));
}

async function postWithRetry(access, body, io, maxRetries) {
  let waited = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response, text;
    try {
      response = await io.fetch(access.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${access.apiKey}`, 'content-type': 'application/json' },
        body,
        signal,
      });
      // Consume failures too: a 429 can describe gateway or provider trouble.
      text = await response.text();
    } catch (error) {
      const detail = signal.aborted ? `timed out after ${REQUEST_TIMEOUT_MS / 1000} s` : error.message;
      throw new Error(`Jev request failed via ${new URL(access.url).host}: ${safeDiagnostic(detail, access.apiKey)}`);
    }
    if (response.status === 429) {
      const detail = httpFailure(access, response, text);
      const stopped = `stopped after ${count(attempt + 1, 'attempt')} and ${waited / 1000} s of retry waits`;
      if (attempt === maxRetries) throw new Error(`${detail}; ${stopped}`);
      const delay = retryDelay(response.headers, attempt, io.now());
      if (waited + delay.ms > MAX_RATE_LIMIT_WAIT_MS) {
        throw new Error(`${detail}; retry delay ${delay.ms / 1000} s (${delay.source}) exceeds remaining retry wait budget ${(MAX_RATE_LIMIT_WAIT_MS - waited) / 1000} s; ${stopped}`);
      }
      io.stderr.write(`ask-jev: ${detail}; retry ${attempt + 1}/${maxRetries} in ${delay.ms / 1000} s (${delay.source})\n`);
      await io.sleep(delay.ms);
      waited += delay.ms;
      continue;
    }
    if (!response.ok) throw new Error(httpFailure(access, response, text));
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Jev returned malformed JSON');
    }
  }
}

function retryDelay(headers, attempt, now) {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter) && Number.isFinite(Number(retryAfter) * 1000)) {
      return { ms: Number(retryAfter) * 1000, source: 'server Retry-After' };
    }
    const date = /[a-z]/i.test(retryAfter) ? Date.parse(retryAfter) : NaN;
    if (Number.isFinite(date)) return { ms: Math.max(0, date - now), source: 'server Retry-After date' };
  }
  const reset = headers.get('x-ratelimit-reset-requests')?.trim();
  const resetMs = reset ? durationMs(reset) : undefined;
  if (Number.isFinite(resetMs)) return { ms: resetMs, source: 'server x-ratelimit-reset-requests' };
  return { ms: 1000 * 2 ** attempt, source: 'local exponential backoff; no usable server retry timing' };
}

function safeDiagnostic(value, apiKey, limit = 2000) {
  return String(value).split(apiKey).join('[redacted]')
    .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [redacted]')
    .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, limit);
}

function httpFailure(access, response, text) {
  let payload;
  try { payload = JSON.parse(text); } catch { /* Some servers return plain text. */ }
  const error = payload?.error ?? payload;
  const message = typeof error === 'string' ? error : error?.message;
  const parts = [safeDiagnostic(message ?? (text || '(empty response body)'), access.apiKey, 600)];
  const code = error?.type ?? error?.code;
  if (code !== undefined) parts.push(`error_type=${safeDiagnostic(code, access.apiKey, 120)}`);
  for (const name of ['retry-after', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests', 'x-request-id', 'request-id', 'x-vercel-id']) {
    const value = response.headers.get(name);
    if (value) parts.push(`${name}=${safeDiagnostic(value, access.apiKey, 160)}`);
  }
  const gateway = payload?.providerMetadata?.gateway ?? payload?.provider_metadata?.gateway;
  if (gateway?.generationId) parts.push(`generation_id=${safeDiagnostic(gateway.generationId, access.apiKey, 160)}`);
  const routing = gateway?.routing;
  if (Number.isInteger(routing?.totalProviderAttemptCount)) parts.push(`provider_attempts=${routing.totalProviderAttemptCount}`);
  if (Array.isArray(routing?.skippedProviderAttempts)) {
    for (const skipped of routing.skippedProviderAttempts.slice(0, 3)) {
      parts.push(`skipped_provider=${safeDiagnostic(skipped?.provider, access.apiKey, 80)}:${safeDiagnostic(skipped?.reason, access.apiKey, 120)}`);
    }
  }
  return `Jev request failed (HTTP ${response.status} via ${new URL(access.url).host}): ${parts.join('; ')}`;
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
