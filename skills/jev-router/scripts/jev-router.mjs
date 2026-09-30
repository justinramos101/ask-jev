#!/usr/bin/env node
// jev-router: detect the terminal host and installed agent CLIs, ask Jev which
// model and reasoning depth a task needs, and print the exact launch plan.
// The calling agent runs the plan; this script never spawns an agent itself.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(SCRIPT_DIR, 'models.json');
const BRIEF_FIELDS = ['task', 'context', 'constraints', 'name', 'prompt', 'include', 'exclude'];
const RUNNER_SUFFIX = join('ask-jev', 'scripts', 'ask-jev.mjs');
const USAGE = `Usage: node jev-router.mjs context
       node jev-router.mjs route <brief.json|-> [--runner <ask-jev.mjs>] [--provider <name>] [--max-retries 0..5]`;

class InputError extends Error {
  constructor(message, showUsage = false) {
    super(message);
    this.showUsage = showUsage;
  }
}

export async function main(argv, io) {
  try {
    const args = parseCli(argv);
    if (args.command === 'help') {
      io.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const catalog = loadCatalog(io);
    const context = detectContext(catalog, io);
    if (args.command === 'context') {
      io.stdout.write(`${JSON.stringify(context)}\n`);
      return 0;
    }
    const brief = readBrief(args.source, io);
    const candidates = selectCandidates(context.candidates, brief);
    const request = buildRequest(brief, context, candidates);
    const evaluation = await (io.askJev ?? runnerAskJev)(request, args, io);
    const result = decide(brief, context, candidates, catalog, evaluation);
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const input = error instanceof InputError;
    io.stderr.write(`jev-router: ${error.message}\n`);
    if (input && error.showUsage) io.stderr.write(`${USAGE}\n`);
    return input ? 2 : 1;
  }
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean' },
        runner: { type: 'string' },
        provider: { type: 'string' },
        'max-retries': { type: 'string' },
      },
    });
  } catch (error) {
    throw new InputError(error.message, true);
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help) return { command: 'help' };
  if (command === 'context') {
    if (rest.length) throw new InputError('context takes no arguments', true);
    return { command };
  }
  if (command === 'route') {
    if (rest.length !== 1) throw new InputError('route requires one JSON path or - for stdin', true);
    return { command, source: rest[0], runner: parsed.values.runner, provider: parsed.values.provider, maxRetries: parsed.values['max-retries'] };
  }
  throw new InputError(`unknown command ${command ?? '(none)'}`, true);
}

function loadCatalog(io) {
  const text = io.readCatalog ? io.readCatalog() : readFileSync(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(text);
  for (const candidate of catalog.candidates) {
    if (!catalog.clis[candidate.cli]) throw new Error(`models.json: candidate ${candidate.id} names unknown cli ${candidate.cli}`);
  }
  return catalog;
}

// Herdr wins over Orca when both are present: Herdr is the multiplexer closest
// to this pane, so its pane commands target the right place.
export function detectHost(env) {
  if (env.HERDR_ENV === '1') {
    return { host: 'herdr', pane: env.HERDR_PANE_ID ?? null, tab: env.HERDR_TAB_ID ?? null, workspace: env.HERDR_WORKSPACE_ID ?? null };
  }
  if (env.ORCA_TERMINAL_HANDLE || env.ORCA_WORKTREE_ID || env.TERM_PROGRAM === 'Orca') {
    return { host: 'orca', terminal: env.ORCA_TERMINAL_HANDLE ?? null, worktree: env.ORCA_WORKTREE_ID ?? null, tab: env.ORCA_TAB_ID ?? null };
  }
  return { host: 'none' };
}

export function detectCurrentAgent(env) {
  if (env.CLAUDE_CODE_SESSION_ID || env.CLAUDECODE) return 'claude';
  if (env.CODEX_SANDBOX || env.CODEX_THREAD_ID || env.CODEX_HOME_SESSION) return 'codex';
  if (env.GEMINI_CLI) return 'gemini';
  if (env.OPENCODE) return 'opencode';
  return 'unknown';
}

function detectContext(catalog, io) {
  const which = io.which ?? whichBinary;
  const installed = {};
  for (const [name, cli] of Object.entries(catalog.clis)) {
    const path = which(cli.binary, io.env);
    if (path) installed[name] = path;
  }
  const candidates = [];
  const unavailable = [];
  for (const candidate of catalog.candidates) {
    (installed[candidate.cli] ? candidates : unavailable).push(candidate);
  }
  return {
    ...detectHost(io.env),
    current_agent: detectCurrentAgent(io.env),
    installed,
    candidates,
    unavailable: unavailable.map(({ id, cli }) => ({ id, cli })),
  };
}

function whichBinary(binary, env) {
  for (const dir of (env.PATH ?? '').split(':')) {
    const path = join(dir, binary);
    if (dir && existsSync(path)) return path;
  }
  return null;
}

function readBrief(source, io) {
  let brief;
  try {
    const text = io.readInput ? io.readInput(source) : readFileSync(source === '-' ? 0 : resolve(io.cwd, source), 'utf8');
    brief = JSON.parse(text);
  } catch (error) {
    throw new InputError(`cannot read brief: ${error.message}`);
  }
  if (brief === null || typeof brief !== 'object' || Array.isArray(brief)) throw new InputError('brief must be an object');
  for (const key of Object.keys(brief)) {
    if (!BRIEF_FIELDS.includes(key)) throw new InputError(`brief has unknown field ${key}`);
  }
  if (typeof brief.task !== 'string' || !brief.task.trim()) throw new InputError('brief.task must be a nonempty string');
  for (const key of ['include', 'exclude']) {
    if (brief[key] !== undefined && !(Array.isArray(brief[key]) && brief[key].every((id) => typeof id === 'string'))) {
      throw new InputError(`brief.${key} must be an array of candidate ids`);
    }
  }
  if (brief.name !== undefined && !/^[a-z][a-z0-9_-]{0,31}$/.test(brief.name)) {
    throw new InputError('brief.name must match [a-z][a-z0-9_-]{0,31}');
  }
  return brief;
}

function selectCandidates(available, brief) {
  const include = brief.include ? new Set(brief.include) : null;
  const exclude = new Set(brief.exclude ?? []);
  const candidates = available.filter((c) => (!include || include.has(c.id)) && !exclude.has(c.id));
  if (candidates.length === 0) {
    throw new InputError('no installed candidate matches the brief; run `context` to see installed CLIs and candidate ids');
  }
  return candidates;
}

function buildRequest(brief, context, candidates) {
  const spawnHost = context.host !== 'none';
  const state = {
    task: brief.task,
    context: brief.context ?? null,
    constraints: brief.constraints ?? null,
    environment: {
      terminal_host: context.host,
      calling_agent_cli: context.current_agent,
      separate_pane_available: spawnHost,
    },
    candidates: candidates.map((c) => ({
      id: c.id, cli: c.cli, model: c.model, tier: c.tier, cost: c.cost, vision: c.vision,
      agentic: c.agentic, local_only: c.cli === 'ollama', notes: c.notes,
    })),
  };
  const criteria = Object.fromEntries(candidates.map((c) => [c.id, `${c.model} via ${c.cli} (${c.tier}, cost ${c.cost})`]));
  criteria.insufficient_evidence = 'The task description does not say enough to choose a candidate.';
  const questions = {
    candidate: {
      type: 'choice',
      instructions: 'Which candidate should run the task? Weigh capability against cost according to the stated constraints: when constraints ask for quality, prefer the most capable candidate; when they ask to minimize cost, or say nothing, choose the least expensive candidate that can still complete the task well. Prefer a candidate with vision when the task involves images or screenshots, an agentic candidate when the task edits files or runs commands, and a local-only candidate only when the task is simple or privacy requires it. Honor any stated requirement about model family or provider.',
      criteria,
    },
    effort: {
      type: 'choice',
      instructions: 'How much reasoning depth does the task need from the chosen model?',
      criteria: {
        low: 'Mechanical or lookup work with an obvious answer.',
        medium: 'Routine implementation with a known pattern.',
        high: 'Design or debugging with some ambiguity or several interacting parts.',
        xhigh: 'Hard problems needing careful planning or long coherent output.',
        max: 'The hardest problems where a wrong answer is expensive to unwind.',
      },
    },
  };
  if (spawnHost) {
    questions.separate_pane = {
      type: 'noul',
      instructions: 'Should the task run as its own agent in a separate visible terminal pane or tab, rather than as an in-process subagent of the calling agent?',
      criteria: {
        true: 'The task is long-running, the user should be able to watch or interact with it, or it should keep working after the caller finishes.',
        false: 'The task is short and bounded and only the caller needs its result.',
      },
    };
  }
  return { state, questions };
}

async function runnerAskJev(request, args, io) {
  const runner = resolveRunner(args.runner, io);
  const argv = [runner, 'ask', '-'];
  if (args.provider) argv.push('--provider', args.provider);
  if (args.maxRetries) argv.push('--max-retries', args.maxRetries);
  try {
    const stdout = execFileSync(process.execPath, argv, { input: JSON.stringify(request), env: io.env, cwd: io.cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Jev was not called or failed: ${detail}`);
  }
}

function resolveRunner(flag, io) {
  const home = io.home ?? homedir();
  const places = [
    flag,
    io.env.ASK_JEV_RUNNER,
    join(SCRIPT_DIR, '..', '..', RUNNER_SUFFIX),
    join(io.cwd, '.claude', 'skills', RUNNER_SUFFIX),
    join(io.cwd, '.agents', 'skills', RUNNER_SUFFIX),
    join(home, '.claude', 'skills', RUNNER_SUFFIX),
    join(home, '.agents', 'skills', RUNNER_SUFFIX),
  ].filter(Boolean);
  const found = places.find((p) => existsSync(p));
  if (!found) throw new InputError('ask-jev runner not found. Install the ask-jev skill beside jev-router, or pass --runner <path to ask-jev.mjs>.');
  return found;
}

function decide(brief, context, candidates, catalog, evaluation) {
  const answers = evaluation?.answers;
  if (!answers?.candidate || !answers?.effort) throw new Error('Jev response is missing the candidate or effort answer');
  const choice = answers.candidate.choice;
  const base = { host: context.host, current_agent: context.current_agent, answers, usage: evaluation.usage ?? null };
  if (choice === 'insufficient_evidence') {
    return { ...base, decision: null, launch: null, reason: 'Jev could not choose a candidate from the brief. Add detail to task, context, or constraints and route again.' };
  }
  const candidate = candidates.find((c) => c.id === choice);
  if (!candidate) throw new Error(`Jev chose unknown candidate ${choice}`);
  const cli = catalog.clis[candidate.cli];
  const effort = mapEffort(answers.effort, catalog.efforts, cli.efforts);
  const placement = choosePlacement(candidate, context, answers.separate_pane?.noul);
  const name = brief.name ?? `worker-${candidate.cli}`;
  const prompt = brief.prompt ?? brief.task;
  const decision = { candidate, effort, placement: placement.mode, reason: placement.reason };
  return { ...base, decision, launch: buildLaunch(placement.mode, candidate, cli, effort, name, prompt, context) };
}

// Universal efforts are ordered. Take Jev's probability-weighted position on
// that scale and pick the supported level nearest to it, lower on ties, so a
// CLI without "xhigh" still lands on the closest depth it offers.
export function mapEffort(answer, universal, supported) {
  if (!supported.length) return null;
  const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
  let expected = 0;
  for (const [level, p] of Object.entries(probabilities)) expected += Math.max(0, universal.indexOf(level)) * p;
  let best = supported[0];
  for (const level of supported) {
    if (Math.abs(universal.indexOf(level) - expected) < Math.abs(universal.indexOf(best) - expected)) best = level;
  }
  return best;
}

function choosePlacement(candidate, context, separatePane) {
  if (!candidate.agentic) return { mode: 'headless', reason: `${candidate.model} is not an interactive agent, so it runs one headless command.` };
  if (context.host === 'none') {
    return candidate.cli === context.current_agent
      ? { mode: 'in_process', reason: 'No pane host detected and the candidate uses the calling CLI, so spawn a native subagent.' }
      : { mode: 'headless', reason: 'No pane host detected and the candidate is a different CLI, so run it headless.' };
  }
  if (candidate.cli !== context.current_agent) {
    return { mode: 'pane', reason: `The candidate uses ${candidate.cli} but the caller is ${context.current_agent}, so it needs its own ${context.host} pane.` };
  }
  if (typeof separatePane === 'number' && separatePane >= 0.5) {
    return { mode: 'pane', reason: `Jev judged the task should run in its own ${context.host} pane (p=${separatePane.toFixed(2)}).` };
  }
  return { mode: 'in_process', reason: `Same CLI as the caller and Jev preferred an in-process subagent (p=${(separatePane ?? 0).toFixed(2)} for a pane).` };
}

function fill(template, candidate, effort, prompt) {
  return template
    .replaceAll('{model}', candidate.model)
    .replaceAll('{effort}', effort ?? '')
    .replaceAll('{prompt}', prompt === undefined ? '' : shellQuote(prompt))
    .replace(/\s+/g, ' ')
    .trim();
}

export function shellQuote(text) {
  return `'${String(text).replaceAll("'", "'\\''")}'`;
}

function buildLaunch(mode, candidate, cli, effort, name, prompt, context) {
  const interactive = fill(cli.interactive, candidate, effort);
  if (mode === 'in_process') {
    return {
      mode,
      note: 'Use the calling CLI\'s native subagent tool. Effort is inherited from the parent session unless the agent definition sets it.',
      model: candidate.model,
      model_alias: claudeAlias(candidate.model),
      effort,
      prompt,
    };
  }
  if (mode === 'headless') {
    return { mode, steps: [fill(cli.headless, candidate, effort, prompt)] };
  }
  if (context.host === 'orca') {
    return {
      mode,
      note: 'Run step 1, read terminal.handle from its JSON, substitute it for <handle>, then run steps 2 and 3. Send only when wait.satisfied is true.',
      steps: [
        `orca terminal create --worktree active --title ${shellQuote(name)} --command ${shellQuote(interactive)} --json`,
        'orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json',
        `orca terminal send --terminal <handle> --text ${shellQuote(prompt)} --enter --json`,
      ],
    };
  }
  const args = interactive.split(' ').slice(1).join(' ');
  return {
    mode,
    note: 'Run step 1, read result.pane.pane_id from its JSON, substitute it for <pane-id>, then run steps 2 and 3. Do not answer a blocked approval dialog without asking the user.',
    steps: cli.herdrKind
      ? [
          'herdr pane split --current --direction right --cwd "$PWD" --no-focus',
          `herdr agent start ${name} --kind ${cli.herdrKind} --pane <pane-id>${args ? ` -- ${args}` : ''}`,
          `herdr agent prompt ${name} ${shellQuote(prompt)} --wait --timeout 600000`,
        ]
      : [
          'herdr pane split --current --direction right --cwd "$PWD" --no-focus',
          `herdr pane run <pane-id> ${shellQuote(fill(cli.headless, candidate, effort, prompt))}`,
        ],
  };
}

function claudeAlias(model) {
  for (const alias of ['fable', 'opus', 'sonnet', 'haiku']) if (model.includes(alias)) return alias;
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
