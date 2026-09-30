import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectCurrentAgent, detectHost, main, mapEffort, shellQuote } from '../skills/jev-router/scripts/jev-router.mjs';

const CATALOG = JSON.stringify({
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  clis: {
    claude: { binary: 'claude', herdrKind: 'claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], interactive: 'claude --model {model} --effort {effort}', headless: 'claude -p --model {model} --effort {effort} {prompt}' },
    codex: { binary: 'codex', herdrKind: 'codex', efforts: ['low', 'medium', 'high', 'xhigh'], interactive: 'codex --model {model} -c model_reasoning_effort="{effort}"', headless: 'codex exec --model {model} {prompt}' },
    ollama: { binary: 'ollama', herdrKind: null, efforts: [], interactive: 'ollama run {model}', headless: 'ollama run {model} {prompt}' },
  },
  candidates: [
    { id: 'claude_big', cli: 'claude', model: 'claude-fable-5-1', tier: 'frontier', cost: 'highest', vision: true, agentic: true, notes: 'big' },
    { id: 'claude_small', cli: 'claude', model: 'claude-haiku-4-5', tier: 'small', cost: 'low', vision: true, agentic: true, notes: 'small' },
    { id: 'codex_big', cli: 'codex', model: 'gpt-6.1-sol', tier: 'frontier', cost: 'high', vision: true, agentic: true, notes: 'codex' },
    { id: 'local', cli: 'ollama', model: 'qwen3.5:9b', tier: 'local', cost: 'free', vision: false, agentic: false, notes: 'local' },
  ],
});

function answers({ candidate, effort = 'medium', pane }) {
  const result = {
    candidate: { type: 'choice', choice: candidate, confidence: 0.9, probabilities: { [candidate]: 1 } },
    effort: { type: 'choice', choice: effort, confidence: 0.9, probabilities: { [effort]: 1 } },
  };
  if (pane !== undefined) result.separate_pane = { type: 'noul', noul: pane };
  return { answers: result, usage: { input_tokens: 1, output_tokens: 1 } };
}

async function run(argv, { env = {}, installed = ['claude', 'codex', 'ollama'], brief, jev = answers({ candidate: 'claude_small' }) } = {}) {
  let stdout = '';
  let stderr = '';
  const requests = [];
  const code = await main(argv, {
    env: { PATH: '/bin', ...env },
    cwd: '/tmp',
    home: '/tmp',
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
    readCatalog: () => CATALOG,
    which: (binary) => (installed.includes(binary) ? `/bin/${binary}` : null),
    readInput: () => JSON.stringify(brief),
    askJev: async (request) => {
      requests.push(request);
      if (jev instanceof Error) throw jev;
      return jev;
    },
  });
  return { code, stdout, stderr, requests, result: stdout ? JSON.parse(stdout) : null };
}

test('detects herdr before orca and the calling agent from the environment', () => {
  assert.equal(detectHost({ HERDR_ENV: '1', HERDR_PANE_ID: 'p1', ORCA_TERMINAL_HANDLE: 't1' }).host, 'herdr');
  assert.deepEqual(detectHost({ ORCA_TERMINAL_HANDLE: 't1', ORCA_TAB_ID: 'tab' }), { host: 'orca', terminal: 't1', worktree: null, tab: 'tab' });
  assert.equal(detectHost({ TERM_PROGRAM: 'Orca' }).host, 'orca');
  assert.deepEqual(detectHost({}), { host: 'none' });
  assert.equal(detectCurrentAgent({ CLAUDE_CODE_SESSION_ID: 's' }), 'claude');
  assert.equal(detectCurrentAgent({ CODEX_SANDBOX: '1' }), 'codex');
  assert.equal(detectCurrentAgent({}), 'unknown');
});

test('context lists installed CLIs, available candidates, and the unavailable rest', async () => {
  const { code, result } = await run(['context'], { installed: ['claude'], env: { CLAUDE_CODE_SESSION_ID: 'x' } });
  assert.equal(code, 0);
  assert.equal(result.host, 'none');
  assert.equal(result.current_agent, 'claude');
  assert.deepEqual(Object.keys(result.installed), ['claude']);
  assert.deepEqual(result.candidates.map((c) => c.id), ['claude_big', 'claude_small']);
  assert.deepEqual(result.unavailable, [{ id: 'codex_big', cli: 'codex' }, { id: 'local', cli: 'ollama' }]);
});

test('route sends only installed candidates and asks the pane question on a pane host', async () => {
  const brief = { task: 'Write tests.', constraints: { cost: 'minimize' }, exclude: ['claude_big'] };
  const { code, requests } = await run(['route', '-'], { brief, installed: ['claude', 'codex'], env: { HERDR_ENV: '1', CLAUDE_CODE_SESSION_ID: 'x' } });
  assert.equal(code, 0);
  const request = requests[0];
  assert.deepEqual(request.state.candidates.map((c) => c.id), ['claude_small', 'codex_big']);
  assert.deepEqual(request.state.environment, { terminal_host: 'herdr', calling_agent_cli: 'claude', separate_pane_available: true });
  assert.deepEqual(Object.keys(request.questions.candidate.criteria), ['claude_small', 'codex_big', 'insufficient_evidence']);
  assert.deepEqual(Object.keys(request.questions), ['candidate', 'effort', 'separate_pane']);
});

test('route omits the pane question when no pane host is present', async () => {
  const { requests } = await run(['route', '-'], { brief: { task: 'x' } });
  assert.deepEqual(Object.keys(requests[0].questions), ['candidate', 'effort']);
});

test('same CLI and a low pane probability spawns an in-process subagent', async () => {
  const jev = answers({ candidate: 'claude_small', effort: 'low', pane: 0.1 });
  const { result } = await run(['route', '-'], { brief: { task: 'x' }, jev, env: { ORCA_TERMINAL_HANDLE: 't', CLAUDE_CODE_SESSION_ID: 'x' } });
  assert.equal(result.decision.placement, 'in_process');
  assert.equal(result.decision.effort, 'low');
  assert.deepEqual(result.launch, {
    mode: 'in_process',
    note: "Use the calling CLI's native subagent tool. Effort is inherited from the parent session unless the agent definition sets it.",
    model: 'claude-haiku-4-5',
    model_alias: 'haiku',
    effort: 'low',
    prompt: 'x',
  });
});

test('a different CLI on orca forces a pane and prints create, wait, and send steps', async () => {
  const jev = answers({ candidate: 'codex_big', effort: 'max', pane: 0.1 });
  const brief = { task: "Review it's all", name: 'reviewer', prompt: 'Review the diff.' };
  const { result } = await run(['route', '-'], { brief, jev, env: { ORCA_TERMINAL_HANDLE: 't', CLAUDE_CODE_SESSION_ID: 'x' } });
  assert.equal(result.decision.placement, 'pane');
  assert.equal(result.decision.effort, 'xhigh');
  assert.deepEqual(result.launch.steps, [
    `orca terminal create --worktree active --title 'reviewer' --command 'codex --model gpt-6.1-sol -c model_reasoning_effort="xhigh"' --json`,
    'orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json',
    "orca terminal send --terminal <handle> --text 'Review the diff.' --enter --json",
  ]);
});

test('a high pane probability on herdr splits a pane and starts the agent by kind', async () => {
  const jev = answers({ candidate: 'claude_big', effort: 'xhigh', pane: 0.9 });
  const { result } = await run(['route', '-'], { brief: { task: 'Long job', name: 'builder' }, jev, env: { HERDR_ENV: '1', HERDR_PANE_ID: 'p1', CLAUDE_CODE_SESSION_ID: 'x' } });
  assert.equal(result.decision.placement, 'pane');
  assert.deepEqual(result.launch.steps, [
    'herdr pane split --current --direction right --cwd "$PWD" --no-focus',
    'herdr agent start builder --kind claude --pane <pane-id> -- --model claude-fable-5-1 --effort xhigh',
    "herdr agent prompt builder 'Long job' --wait --timeout 600000",
  ]);
});

test('a non-agent candidate always runs one headless command', async () => {
  const jev = answers({ candidate: 'local', effort: 'low', pane: 0.9 });
  const { result } = await run(['route', '-'], { brief: { task: 'Classify "this"' }, jev, env: { HERDR_ENV: '1' } });
  assert.equal(result.decision.placement, 'headless');
  assert.equal(result.decision.effort, null);
  assert.deepEqual(result.launch, { mode: 'headless', steps: ["ollama run qwen3.5:9b 'Classify \"this\"'"] });
});

test('a different CLI without a pane host runs headless', async () => {
  const jev = answers({ candidate: 'codex_big', effort: 'high' });
  const { result } = await run(['route', '-'], { brief: { task: 'go' }, jev, env: { CLAUDE_CODE_SESSION_ID: 'x' } });
  assert.equal(result.decision.placement, 'headless');
  assert.deepEqual(result.launch.steps, ["codex exec --model gpt-6.1-sol 'go'"]);
});

test('insufficient evidence returns no launch plan', async () => {
  const { code, result } = await run(['route', '-'], { brief: { task: 'x' }, jev: answers({ candidate: 'insufficient_evidence' }) });
  assert.equal(code, 0);
  assert.equal(result.decision, null);
  assert.equal(result.launch, null);
  assert.match(result.reason, /Add detail/);
});

test('maps effort to the nearest supported level by probability mass', () => {
  const universal = ['low', 'medium', 'high', 'xhigh', 'max'];
  assert.equal(mapEffort({ choice: 'max', probabilities: { max: 1 } }, universal, ['low', 'medium', 'high', 'xhigh']), 'xhigh');
  assert.equal(mapEffort({ choice: 'xhigh', probabilities: { xhigh: 0.39, high: 0.24, max: 0.37 } }, universal, ['low', 'medium', 'high', 'max']), 'max');
  assert.equal(mapEffort({ choice: 'medium' }, universal, ['low', 'high']), 'low');
  assert.equal(mapEffort({ choice: 'max' }, universal, []), null);
});

test('rejects malformed briefs and empty candidate sets with exit code 2', async () => {
  for (const [brief, message] of [
    [{ goal: 'x' }, 'brief has unknown field goal'],
    [{ task: '' }, 'brief.task must be a nonempty string'],
    [{ task: 'x', name: 'Bad Name' }, 'brief.name must match [a-z][a-z0-9_-]{0,31}'],
    [{ task: 'x', include: ['codex_big'] }, 'no installed candidate matches the brief; run `context` to see installed CLIs and candidate ids'],
  ]) {
    const { code, stderr, requests } = await run(['route', '-'], { brief, installed: ['claude'] });
    assert.equal(code, 2, stderr);
    assert.equal(requests.length, 0);
    assert.equal(stderr.split('\n')[0], `jev-router: ${message}`);
  }
});

test('a failed Jev call reports the error and exits 1 without a plan', async () => {
  const { code, stdout, stderr } = await run(['route', '-'], { brief: { task: 'x' }, jev: new Error('Jev was not called or failed: no API key') });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, 'jev-router: Jev was not called or failed: no API key\n');
});

test('quotes prompts for a POSIX shell', () => {
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});
