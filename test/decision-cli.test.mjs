import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { main } from '../skills/ask-jev/scripts/ask-jev.mjs';

const request = {
  state: { incident: 'Uploads fail', evidence: [null, false, { log: '  preserve indentation\n' + 'x'.repeat(100_000) }] },
  questions: {
    route: { type: 'choice', instructions: { question: 'Who handles this?' }, criteria: { storage: ['Upload failures'], frontend: null } },
    impact: { type: 'score', instructions: ['Rate impact'], criteria: ['None', { impact: 'Some' }, ['All']] },
    supported: { type: 'noul', instructions: 'Does evidence support an outage?', criteria: { true: 'Evidence supports', false: ['Evidence contradicts'] } },
  },
};
const response = {
  model: 'jev-1.13.0',
  answers: {
    route: { type: 'choice', choice: 'storage', probabilities: { storage: 0.9, frontend: 0.1 }, confidence: 0.8 },
    impact: { type: 'score', score: 1.05, probabilities: { 0: 0, 1: 0.95, 2: 0.05 }, confidence: 0.92, legend: { 0: 'None', 1: 'Some', 2: 'All' } },
    supported: { type: 'noul', noul: 0.73 },
  },
  usage: { input_tokens: 300, output_tokens: 50 },
  metadata: { trace: 'keep-me' },
};

async function run(argv = ['ask', '-'], options = {}) {
  let stdout = '';
  let stderr = '';
  const requests = [];
  const sleeps = [];
  const code = await main(argv, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? { TYPESAFE_API_KEY: 'test-key', AI_GATEWAY_API_KEY: 'gateway-key' },
    now: () => 0,
    readInput: options.fromFile ? undefined : async () => options.input ?? JSON.stringify(request),
    fetch: async (url, init) => {
      requests.push({ url, ...init, body: JSON.parse(init.body) });
      if (options.retry && requests.length === 1) return new Response('', { status: 429, headers: { 'retry-after': '0.001' } });
      return new Response(options.rawResponse ?? JSON.stringify(options.response ?? response));
    },
    sleep: async (ms) => sleeps.push(ms),
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
  });
  return { code, stdout, stderr, requests, sleeps };
}

test('mixed judgments retain nested context, instructions and all response metadata in one call', async () => {
  const result = await run();
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), response);
  assert.equal(result.requests.length, 1);
  assert.deepEqual(result.requests[0].body, { model: 'jev-latest', ...request });
  assert.equal(result.requests[0].headers.authorization, 'Bearer test-key');
});

test('file source is resolved from io.cwd and explicit gateway survives retry unchanged', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'jev-decision-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'input.json'), JSON.stringify(request));
  const result = await run(['ask', 'input.json', '--provider', 'vercel'], { cwd, fromFile: true, retry: true });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), response);
  assert.equal(result.stderr, 'ask-jev: rate limited, waiting 1 s\n');
  assert.deepEqual(result.sleeps, [1]);
  assert.equal(result.requests.length, 2);
  assert.deepEqual(result.requests[0], result.requests[1]);
  assert.equal(result.requests[0].url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
  assert.equal(result.requests[0].body.model, 'typesafe-ai/jev');
  assert.equal(result.requests[0].headers.authorization, 'Bearer gateway-key');
});

test('string and array states and optional noul criteria are supported without manufactured fields', async () => {
  for (const state of ['plain evidence', [{ path: 'a.ts' }, null, true]]) {
    const input = JSON.stringify({ state, questions: { q: { type: 'noul', instructions: 'Is it supported?' } } });
    const result = await run(undefined, { input, response: { answers: { q: { type: 'noul', noul: 0 } } } });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { answers: { q: { type: 'noul', noul: 0 } } });
    assert.deepEqual(result.requests[0].body.state, state);
  }
});

test('invalid requests fail before network with actionable input errors', async () => {
  const question = (q) => ({ state: 'evidence', questions: { q } });
  const invalid = [
    ['{', /cannot read JSON/],
    [[], /request must be an object/],
    [{ ...request, model: 'override' }, /unknown field model/],
    [{ ...request, state: null }, /state must be/],
    [{ ...request, questions: {} }, /nonempty object/],
    [{ ...request, questions: [] }, /nonempty object/],
    [question(null), /must be an object/],
    [question({ type: 'noul', instruction: 'typo' }), /unknown field instruction/],
    [question({ type: 'noul', instructions: 1 }), /instructions must be/],
    [question({ type: 'generate', instructions: 'x' }), /type must be/],
    [question({ type: 'choice', instructions: 'x', criteria: {} }), /1\.\.255/],
    [question({ type: 'choice', instructions: 'x', criteria: { a: true } }), /1\.\.255/],
    [question({ type: 'choice', instructions: 'x', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [i, null])) }), /1\.\.255/],
    [question({ type: 'score', instructions: 'x', criteria: ['one'] }), /2\.\.10/],
    [question({ type: 'score', instructions: 'x', criteria: Array(11).fill('x') }), /2\.\.10/],
    [question({ type: 'score', instructions: 'x', criteria: ['x', null] }), /2\.\.10/],
    [question({ type: 'noul', instructions: 'x', criteria: { yes: 'x' } }), /unknown field yes/],
    [question({ type: 'noul', instructions: 'x', criteria: { true: false } }), /descriptions must be/],
  ];
  for (const [value, message] of invalid) {
    const result = await run(undefined, { input: typeof value === 'string' ? value : JSON.stringify(value), env: {} });
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, '');
    assert.equal(result.requests.length, 0);
  }
});

test('missing inputs and command-inapplicable flags are input errors', async () => {
  for (const argv of [['ask'], ['ask', '-', 'extra'], ['ask', '-', '--goal', 'x'], ['ask', '-', '--top', '8'], ['ask', '-', '--min', '0.3'], ['ask', '-', '--provider', 'unknown']]) {
    const result = await run(argv);
    assert.equal(result.code, 2, argv.join(' '));
    assert.match(result.stderr, /ask-jev:/);
    assert.equal(result.stdout, '');
    assert.equal(result.requests.length, 0);
  }
  const missing = await run(['ask', '/no-such-jev-request.json'], { fromFile: true });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /cannot read JSON request/);
  const help = await run(['--help'], { env: {} });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /ask <request.json\|->/);
  assert.match(help.stdout, /files --goal/);
});

test('malformed and invalid answers never reach stdout', async () => {
  const invalid = [null, [], { answers: {} }, { ...response, answers: [] }];
  for (const [id, field, value] of [
    ['supported', 'type', 'score'], ['supported', 'noul', -0.1], ['supported', 'noul', 1.1], ['supported', 'noul', '0.5'],
    ['route', 'choice', 'unknown'], ['route', 'confidence', 2], ['route', 'confidence', null],
    ['route', 'probabilities', [0.9, 0.1]], ['route', 'probabilities', { storage: 0.9 }],
    ['route', 'probabilities', { storage: 0.9, frontend: -0.1 }],
    ['impact', 'score', 2.1], ['impact', 'probabilities', { 0: 0.5, 1: 0.5, other: 0 }],
  ]) {
    const body = structuredClone(response);
    body.answers[id][field] = value;
    invalid.push(body);
  }
  for (const body of invalid) {
    const result = await run(undefined, { rawResponse: JSON.stringify(body) });
    assert.equal(result.code, 1, JSON.stringify(body));
    assert.match(result.stderr, /Jev returned/);
    assert.equal(result.stdout, '');
  }
  for (const rawResponse of ['{', '{"answers":{"route":{"type":"choice","choice":"storage","confidence":1e400}}}']) {
    const result = await run(undefined, { rawResponse });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Jev returned/);
    assert.equal(result.stdout, '');
  }
});

test('production entrypoint reads stdin and file JSON with offline fetch preload', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'jev-cli-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const input = JSON.stringify({ state: ['verbatim', { nested: true }], questions: { q: { type: 'noul', instructions: 'Supported?' } } });
  writeFileSync(join(cwd, 'request.json'), input);
  writeFileSync(join(cwd, 'fetch.cjs'), `globalThis.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    if (request.model !== 'jev-latest' || request.state[1].nested !== true) throw new Error('wrong request');
    return { status: 200, ok: true, text: async () => JSON.stringify({ answers: { q: { type: 'noul', noul: 0.75 } }, usage: { input_tokens: 9 } }) };
  };`);
  const script = fileURLToPath(new URL('../skills/ask-jev/scripts/ask-jev.mjs', import.meta.url));
  for (const source of ['-', 'request.json']) {
    const result = spawnSync(process.execPath, ['--require', join(cwd, 'fetch.cjs'), script, 'ask', source], {
      cwd, input, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: 'offline-test-key' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { answers: { q: { type: 'noul', noul: 0.75 } }, usage: { input_tokens: 9 } });
  }
});

test('bundled decision example executes all three question types', async () => {
  const source = fileURLToPath(new URL('../skills/ask-jev/examples/decision.json', import.meta.url));
  const expected = {
    answers: {
      next_investigation: {
        type: 'choice', choice: 'storage', confidence: 0.8,
        probabilities: { storage: 0.9, authentication: 0.05, insufficient_evidence: 0.05 },
      },
      impact: {
        type: 'score', score: 1, confidence: 0.85,
        probabilities: { 0: 0.05, 1: 0.9, 2: 0.05 },
        legend: { 0: 'Both work', 1: 'One fails', 2: 'Both fail' },
      },
      storage_evidence: { type: 'noul', noul: 0.95 },
    },
    usage: { input_tokens: 200, output_tokens: 40 },
  };
  const result = await run(['ask', source], { fromFile: true, response: expected });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.deepEqual(
    Object.entries(result.requests[0].body.questions).map(([id, question]) => [id, question.type]),
    [['next_investigation', 'choice'], ['impact', 'score'], ['storage_evidence', 'noul']],
  );
});
