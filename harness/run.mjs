#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(HERE, '..', 'skills', 'ask-jev');
const SKILL_FILES = ['SKILL.md', 'scripts/ask-jev.mjs'];
const SKILL_HOMES = ['.claude/skills/ask-jev', '.agents/skills/ask-jev'];
const READ_COMMAND = /(?<!\|\s*)(?:^|[\s;&('"])(?:cat|head|tail|nl|less|bat|sed\s+-n)\s/g;

const { values: opts } = parseArgs({
  options: {
    agents: { type: 'string', default: 'claude,codex' },
    arms: { type: 'string', default: 'skill,bare' },
    tasks: { type: 'string' },
    limit: { type: 'string' },
    root: { type: 'string', default: join(tmpdir(), 'hono-dev') },
    'timeout-min': { type: 'string', default: '15' },
    keep: { type: 'boolean', default: false },
  },
});

const AGENTS = {
  claude: {
    command: (copy, prompt) => [
      'claude',
      ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--no-session-persistence'],
    ],
    parse: parseClaude,
  },
  codex: {
    command: (copy, prompt) => [
      'codex',
      ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-C', copy, '-s', 'workspace-write',
        '-c', 'sandbox_workspace_write.network_access=true', prompt],
    ],
    parse: parseCodex,
  },
};

function parseClaude(events) {
  const commands = [];
  let reads = 0;
  let loaded = false;
  let model;
  let result;
  for (const event of events) {
    if (event.type === 'system' && event.subtype === 'init') model = event.model;
    if (event.type === 'result') result = event;
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_use') continue;
      const input = block.input ?? {};
      if (block.name === 'Read') {
        reads++;
        if (String(input.file_path).includes('ask-jev/SKILL.md')) loaded = true;
      }
      if (block.name === 'Skill' && String(input.skill ?? input.command ?? '').includes('ask-jev')) loaded = true;
      if (block.name === 'Bash') commands.push(String(input.command ?? ''));
    }
  }
  const usage = Object.values(result?.modelUsage ?? {});
  const total = (field) => usage.reduce((sum, model) => sum + (model[field] ?? 0), 0);
  return {
    model,
    commands,
    reads: reads + countReads(commands),
    loaded,
    finalText: result?.result ?? '',
    tokens: {
      input: total('inputTokens') + total('cacheCreationInputTokens') + total('cacheReadInputTokens'),
      cached: total('cacheReadInputTokens'),
      output: total('outputTokens'),
    },
    cost: result?.total_cost_usd,
  };
}

function parseCodex(events) {
  const commands = [];
  let finalText = '';
  const tokens = { input: 0, cached: 0, output: 0 };
  for (const event of events) {
    const item = event.item;
    if (event.type === 'item.completed' && item?.type === 'command_execution') commands.push(item.command);
    if (event.type === 'item.completed' && item?.type === 'agent_message') finalText = item.text;
    if (event.type === 'turn.completed') {
      tokens.input += event.usage?.input_tokens ?? 0;
      tokens.cached += event.usage?.cached_input_tokens ?? 0;
      tokens.output += event.usage?.output_tokens ?? 0;
    }
  }
  return {
    model: codexModel(),
    commands,
    reads: countReads(commands),
    loaded: commands.some((command) => command.includes('ask-jev/SKILL.md')),
    finalText,
    tokens,
    cost: undefined,
  };
}

function codexModel() {
  try {
    return readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8').match(/^model\s*=\s*"([^"]+)"/m)?.[1];
  } catch {
    return undefined;
  }
}

function countReads(commands) {
  return commands.reduce((sum, command) => sum + [...command.matchAll(READ_COMMAND)].length, 0);
}

function namesFile(text, path, basenameCounts) {
  const name = basename(path);
  const needle = basenameCounts.get(name) > 1 ? path.split('/').slice(-2).join('/') : name;
  return text.includes(needle);
}

function prepareFixture(fixture, root) {
  const cache = join(root, 'cache', 'hono');
  if (!existsSync(join(cache, '.git'))) {
    mkdirSync(dirname(cache), { recursive: true });
    execFileSync('git', ['clone', '-q', '--branch', fixture.tag, fixture.repo, cache], { stdio: 'inherit' });
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cache, encoding: 'utf8' }).trim();
  if (head !== fixture.commit) throw new Error(`fixture at ${head}, expected ${fixture.commit}`);
  if (!existsSync(join(cache, 'node_modules'))) {
    execFileSync(fixture.install[0], fixture.install.slice(1), { cwd: cache, stdio: 'inherit' });
  }
  return cache;
}

function freshCopy(cache, root) {
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  let n = 1;
  while (existsSync(join(work, `hono-app-${n}`))) n++;
  const copy = join(work, `hono-app-${n}`);
  // APFS clones make the 900 MB copy (mostly node_modules) take seconds.
  execFileSync('cp', [platform() === 'darwin' ? '-cR' : '-R', cache, copy]);
  return copy;
}

function installSkill(copy) {
  for (const home of SKILL_HOMES) {
    for (const file of SKILL_FILES) {
      mkdirSync(dirname(join(copy, home, file)), { recursive: true });
      copyFileSync(join(SKILL_DIR, file), join(copy, home, file));
    }
  }
  appendFileSync(join(copy, '.git', 'info', 'exclude'), '.claude/\n.agents/\n');
}

// A claude started from inside a Claude Code session inherits that session's
// identity through these variables; the runs must start clean.
const PARENT_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_JOB_DIR|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|AGENT|MESSAGING_\w+|SESSION_ATTENDED|EXECPATH))$/;

function agentEnv(key) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !PARENT_SESSION_VARS.test(name)));
  return { ...env, AI_GATEWAY_API_KEY: key };
}

function runAgent(agent, copy, prompt, env, timeoutMs) {
  const [cmd, args] = AGENTS[agent].command(copy, prompt);
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: copy, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut });
    });
  });
}

function parseEvents(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const pct = (hits, total) => (total === 0 ? 'n/a' : `${Math.round((100 * hits) / total)}% (${hits}/${total})`);
const mean = (values) => (values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length);
const num = (value, digits = 0) => (value === undefined ? 'n/a' : value.toFixed(digits));
const money = (value) => (value === undefined ? 'n/a' : `$${value.toFixed(3)}`);

function summarize(runs, agents, arms) {
  const lines = [
    '| agent | arm | runs | trigger rate | false-trigger rate | answer accuracy | mean input tok | mean cached tok | mean output tok | mean cost | mean wall s | mean file reads |',
    `|${' --- |'.repeat(12)}`,
  ];
  for (const agent of agents) {
    for (const arm of arms) {
      const group = runs.filter((run) => run.agent === agent && run.arm === arm);
      if (group.length === 0) continue;
      const should = group.filter((run) => run.expectTrigger);
      const shouldNot = group.filter((run) => !run.expectTrigger);
      const costs = group.map((run) => run.cost).filter((cost) => cost !== undefined);
      lines.push(
        `| ${agent} | ${arm} | ${group.length} | ${pct(should.filter((r) => r.invoked).length, should.length)} | ${pct(shouldNot.filter((r) => r.invoked).length, shouldNot.length)} | ${pct(should.filter((r) => r.answerOk).length, should.length)} | ${num(mean(group.map((r) => r.tokens.input)))} | ${num(mean(group.map((r) => r.tokens.cached)))} | ${num(mean(group.map((r) => r.tokens.output)))} | ${money(mean(costs))} | ${num(mean(group.map((r) => r.wallS)), 1)} | ${num(mean(group.map((r) => r.reads)), 1)} |`,
      );
    }
  }
  return lines.join('\n');
}

function perRunTable(runs) {
  const lines = [
    '| task | expect | agent | arm | invoked | loaded skill | answer ok | file reads | input tok | cached tok | output tok | cost | wall s | exit |',
    `|${' --- |'.repeat(14)}`,
  ];
  for (const r of runs) {
    lines.push(
      `| ${r.task} | ${r.expectTrigger ? 'trigger' : 'no trigger'} | ${r.agent} | ${r.arm} | ${r.invoked ? `yes (${r.invocations})` : 'no'} | ${r.loaded ? 'yes' : 'no'} | ${r.expectTrigger ? (r.answerOk ? 'yes' : `no (missing ${r.missing.join(', ')})`) : 'n/a'} | ${r.reads} | ${r.tokens.input} | ${r.tokens.cached} | ${r.tokens.output} | ${money(r.cost)} | ${r.wallS.toFixed(1)} | ${r.timedOut ? 'timeout' : r.exitCode} |`,
    );
  }
  return lines.join('\n');
}

async function main() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error('set AI_GATEWAY_API_KEY; the agents pass it to ask-jev');
  const { fixture, tasks: allTasks } = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));
  const agents = opts.agents.split(',');
  const arms = opts.arms.split(',');
  for (const agent of agents) if (!AGENTS[agent]) throw new Error(`unknown agent ${agent}`);
  for (const arm of arms) if (arm !== 'skill' && arm !== 'bare') throw new Error(`unknown arm ${arm}`);
  const wanted = opts.tasks?.split(',');
  let tasks = wanted ? allTasks.filter((task) => wanted.includes(task.id)) : allTasks;
  if (wanted && tasks.length !== wanted.length) throw new Error(`unknown task in ${opts.tasks}`);
  if (opts.limit) tasks = tasks.slice(0, Number(opts.limit));

  const cache = prepareFixture(fixture, opts.root);
  const basenameCounts = new Map();
  for (const path of execFileSync('git', ['ls-files'], { cwd: cache, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    basenameCounts.set(basename(path), (basenameCounts.get(basename(path)) ?? 0) + 1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const streams = join(opts.root, 'streams', stamp);
  mkdirSync(streams, { recursive: true });
  const env = agentEnv(key);
  const runs = [];

  for (const task of tasks) {
    for (const agent of agents) {
      for (const arm of arms) {
        const copy = freshCopy(cache, opts.root);
        if (arm === 'skill') installSkill(copy);
        const started = Date.now();
        const outcome = await runAgent(agent, copy, task.prompt, env, Number(opts['timeout-min']) * 60_000);
        const wallS = (Date.now() - started) / 1000;
        const raw = `${outcome.stdout}\n${outcome.stderr ? `\n# stderr\n${outcome.stderr}` : ''}`.replaceAll(key, '[redacted]');
        writeFileSync(join(streams, `${task.id}.${agent}.${arm}.jsonl`), raw);
        const parsed = AGENTS[agent].parse(parseEvents(outcome.stdout));
        const invocations = parsed.commands.filter((command) => command.includes('ask-jev.mjs')).length;
        const missing = (task.answerFiles ?? []).filter((path) => !namesFile(parsed.finalText, path, basenameCounts));
        const run = {
          task: task.id,
          expectTrigger: task.expectTrigger,
          agent,
          arm,
          model: parsed.model,
          invoked: invocations > 0,
          invocations,
          loaded: parsed.loaded,
          answerOk: task.expectTrigger ? missing.length === 0 : undefined,
          missing,
          reads: parsed.reads,
          tokens: parsed.tokens,
          cost: parsed.cost,
          wallS,
          exitCode: outcome.code,
          timedOut: outcome.timedOut,
        };
        runs.push(run);
        process.stderr.write(
          `${task.id} ${agent} ${arm}: invoked=${run.invoked} loaded=${run.loaded} answerOk=${run.answerOk ?? 'n/a'} reads=${run.reads} cost=${money(run.cost)} wall=${wallS.toFixed(1)}s exit=${outcome.timedOut ? 'timeout' : outcome.code}\n`,
        );
        if (!opts.keep) rmSync(copy, { recursive: true, force: true });
      }
    }
  }

  const models = [...new Set(runs.map((run) => `${run.agent}: ${run.model ?? 'unknown'}`))].join(', ');
  const report = [
    `# ask-jev trigger run ${stamp}`,
    '',
    `Fixture: ${fixture.repo} ${fixture.tag} (${fixture.commit}). Models: ${models}. Raw streams: ${streams}`,
    '',
    summarize(runs, agents, arms),
    '',
    '## Runs',
    '',
    perRunTable(runs),
    '',
  ].join('\n');
  mkdirSync(join(HERE, 'results'), { recursive: true });
  writeFileSync(join(HERE, 'results', `${stamp}.md`), report);
  writeFileSync(join(streams, 'runs.json'), JSON.stringify(runs, null, 2));
  process.stdout.write(report);
}

main().catch((error) => {
  process.stderr.write(`run.mjs: ${error.message}\n`);
  process.exitCode = 1;
});
