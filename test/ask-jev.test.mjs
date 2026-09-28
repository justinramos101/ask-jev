import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { main } from '../skills/ask-jev/scripts/ask-jev.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'ask-jev-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function ok(body) {
  return { status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify(body) };
}

function tooMany(headers) {
  return { status: 429, ok: false, headers: new Headers(headers), text: async () => 'rate limited' };
}

function fakeJev({ scoreOf = () => 0.5, responses = [] } = {}) {
  const requests = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = async (url, init) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const request = { url, headers: init.headers, body: JSON.parse(init.body) };
    requests.push(request);
    await new Promise((done) => setTimeout(done, 1));
    inFlight--;
    const override = responses[requests.length - 1];
    if (override) return override;
    const pathOf = Object.fromEntries(request.body.state.files.map((file) => [file.id, file.path]));
    const answers = Object.fromEntries(
      Object.keys(request.body.questions).map((id) => [id, { type: 'noul', noul: scoreOf(pathOf[id]) }]),
    );
    return ok({ answers, usage: { input_tokens: 1, output_tokens: 1 } });
  };
  return { fetch, requests, maxInFlight: () => maxInFlight };
}

async function run(argv, { cwd, jev = fakeJev(), env = { AI_GATEWAY_API_KEY: 'gw-key' } }) {
  let stdout = '';
  let stderr = '';
  const sleeps = [];
  const code = await main(argv, {
    cwd,
    env,
    fetch: jev.fetch,
    sleep: async (ms) => sleeps.push(ms),
    now: () => 1_000,
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
  });
  return { code, stdout, stderr, sleeps, requests: jev.requests };
}

test('prints the top files at or above --min, highest first', async () => {
  const cwd = project({ 'src/a.ts': 'a', 'src/b.ts': 'b', 'src/c.ts': 'c', 'src/d.ts': 'd' });
  const scores = { 'src/a.ts': 0.31, 'src/b.ts': 0.94, 'src/c.ts': 0.12, 'src/d.ts': 0.6 };
  const jev = fakeJev({ scoreOf: (path) => scores[path] });

  const result = await run(['files', '--goal', 'find b', '--top', '2', 'src'], { cwd, jev });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'Scored 4 files in 1 request, 0.0 s.\n0.94  src/b.ts\n0.60  src/d.ts\n');
  assert.equal(result.stderr, '');
});

test('says so and prints the best 3 when no file reaches --min', async () => {
  const cwd = project({ 'a.md': 'a', 'b.md': 'b', 'c.md': 'c', 'd.md': 'd' });
  const scores = { 'a.md': 0.05, 'b.md': 0.2, 'c.md': 0.11, 'd.md': 0.01 };
  const jev = fakeJev({ scoreOf: (path) => scores[path] });

  const result = await run(['files', '--goal', 'x', '--min', '0.5', '.'], { cwd, jev });

  assert.equal(
    result.stdout,
    'Scored 4 files in 1 request, 0.0 s.\nNo file scored 0.50 or higher. Best 3:\n0.20  b.md\n0.11  c.md\n0.05  a.md\n',
  );
});

test('packs files into sequential requests that stay under the state budget', async () => {
  const files = {};
  for (let i = 0; i < 70; i++) files[`lib/file${String(i).padStart(2, '0')}.js`] = `// file ${i}\n${'x'.repeat(3000)}\n`;
  const cwd = project(files);
  const jev = fakeJev();

  const result = await run(['files', '--goal', 'anything', 'lib'], { cwd, jev });

  assert.equal(result.code, 0);
  assert.equal(result.stdout.split('\n')[0], 'Scored 70 files in 3 requests, 0.0 s.');
  assert.deepEqual(
    result.requests.map((request) => Object.keys(request.body.questions).length),
    [33, 33, 4],
  );
  for (const request of result.requests) {
    assert.ok(JSON.stringify(request.body.state).length / 3.5 <= 24_000);
  }
  const asked = result.requests.flatMap((request) => Object.keys(request.body.questions));
  assert.deepEqual(asked, Array.from({ length: 70 }, (_, i) => `f${i + 1}`));
  assert.equal(jev.maxInFlight(), 1);
  assert.equal(
    result.requests[0].body.questions.f1.instructions,
    'File f1 (lib/file00.js) contains code or text the assistant must read to accomplish the goal.',
  );
});

test('waits out a 429 for the retry-after seconds, then retries', async () => {
  const cwd = project({ 'a.ts': 'a' });
  const jev = fakeJev({ scoreOf: () => 0.8, responses: [tooMany({ 'retry-after': '7' })] });

  const result = await run(['files', '--goal', 'x', 'a.ts'], { cwd, jev });

  assert.equal(result.code, 0);
  assert.deepEqual(result.sleeps, [7000]);
  assert.equal(result.requests.length, 2);
  assert.match(result.stderr, /HTTP 429 via ai-gateway\.vercel\.sh\): rate limited/);
  assert.match(result.stderr, /retry 1\/2 in 7 s \(server Retry-After\)/);
  assert.equal(result.stdout, 'Scored 1 file in 1 request, 0.0 s.\n0.80  a.ts\n');
});

test('falls back to x-ratelimit-reset-requests when retry-after is absent', async () => {
  const cwd = project({ 'a.ts': 'a' });
  const jev = fakeJev({ responses: [tooMany({ 'x-ratelimit-reset-requests': '1m2s' })] });

  const result = await run(['files', '--goal', 'x', 'a.ts'], { cwd, jev });

  assert.deepEqual(result.sleeps, [62000]);
});

test('files respects --max-retries 0', async () => {
  const cwd = project({ 'a.ts': 'a' });
  const jev = fakeJev({ responses: [tooMany({ 'retry-after': '7' })] });
  const result = await run(['files', '--goal', 'x', '--max-retries', '0', 'a.ts'], { cwd, jev });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.deepEqual(result.sleeps, []);
  assert.equal(result.stdout, '');
});

test('gives up when the rate limit wait passes 90 seconds', async () => {
  const cwd = project({ 'a.ts': 'a' });
  const jev = fakeJev({ responses: [tooMany({ 'retry-after': '60' }), tooMany({ 'retry-after': '45' })] });

  const result = await run(['files', '--goal', 'x', 'a.ts'], { cwd, jev });

  assert.equal(result.code, 1);
  assert.deepEqual(result.sleeps, [60000]);
  assert.equal(result.stdout, '');
  assert.equal(result.requests.length, 2);
  assert.match(result.stderr, /retry 1\/2 in 60 s \(server Retry-After\)/);
  assert.match(result.stderr, /retry delay 45 s .* exceeds remaining retry wait budget 30 s; stopped after 2 attempts and 60 s of retry waits/);
});

test('skips binary files, lockfiles and files over 200 KB', async () => {
  const cwd = project({
    'app/main.ts': 'export {}',
    'app/package-lock.json': '{}',
    'app/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    'app/huge.json': `"${'y'.repeat(210 * 1024)}"`,
  });
  const jev = fakeJev();

  const result = await run(['files', '--goal', 'x', 'app'], { cwd, jev });

  assert.equal(result.stdout.split('\n')[0], 'Scored 1 file (skipped 3 binary, lock or oversized) in 1 request, 0.0 s.');
  assert.deepEqual(result.requests[0].body.state.files.map((file) => file.path), ['app/main.ts']);
});

test('inside a git repo, targets expand to unignored files and honor exclude pathspecs', async () => {
  const cwd = project({
    '.gitignore': 'dist/\nnode_modules/\n',
    'src/index.ts': 'export {}',
    'src/index.test.ts': 'test',
    'dist/index.js': 'built',
    'node_modules/dep/index.js': 'dep',
  });
  execFileSync('git', ['init', '-q'], { cwd });

  const result = await run(['files', '--goal', 'x', '.', ':!*.test.ts'], { cwd });

  assert.deepEqual(result.requests[0].body.state.files.map((file) => file.path), ['.gitignore', 'src/index.ts']);
});

test('expands a quoted glob outside a git repo', async () => {
  const cwd = project({ 'src/a.ts': 'a', 'src/deep/b.ts': 'b', 'src/c.md': 'c', 'node_modules/x.ts': 'x' });

  const result = await run(['files', '--goal', 'x', 'src/**/*.ts'], { cwd });

  assert.deepEqual(result.requests[0].body.state.files.map((file) => file.path).sort(), ['src/a.ts', 'src/deep/b.ts']);
});

test('auto provider prefers the TypeSafe key, then Cloudflare, then the Vercel gateway key', async () => {
  const cwd = project({ 'a.ts': 'a' });
  const cloudflare = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct123' };

  const all = await run(['files', '--goal', 'x', 'a.ts'], {
    cwd,
    env: { TYPESAFE_API_KEY: 'ts-key', AI_GATEWAY_API_KEY: 'gw-key', ...cloudflare },
  });
  const cloudflareAndVercel = await run(['files', '--goal', 'x', 'a.ts'], { cwd, env: { AI_GATEWAY_API_KEY: 'gw-key', ...cloudflare } });
  const vercelOnly = await run(['files', '--goal', 'x', 'a.ts'], { cwd, env: { AI_GATEWAY_API_KEY: 'gw-key' } });
  const halfCloudflare = await run(['files', '--goal', 'x', 'a.ts'], { cwd, env: { AI_GATEWAY_API_KEY: 'gw-key', CLOUDFLARE_API_TOKEN: 'cf-token' } });
  const none = await run(['files', '--goal', 'x', 'a.ts'], { cwd, env: {} });

  assert.deepEqual(
    [all.requests[0].url, all.requests[0].body.model, all.requests[0].headers.authorization],
    ['https://api.typesafe.ai/v1/systemone', 'jev-latest', 'Bearer ts-key'],
  );
  assert.deepEqual(
    [cloudflareAndVercel.requests[0].url, cloudflareAndVercel.requests[0].body.model, cloudflareAndVercel.requests[0].headers.authorization],
    ['https://api.cloudflare.com/client/v4/accounts/acct123/ai/run', 'typesafe/jev', 'Bearer cf-token'],
  );
  assert.deepEqual(
    [vercelOnly.requests[0].url, vercelOnly.requests[0].body.model, vercelOnly.requests[0].headers.authorization],
    ['https://ai-gateway.vercel.sh/typesafe/v1/systemone', 'typesafe-ai/jev', 'Bearer gw-key'],
  );
  assert.equal(halfCloudflare.requests[0].url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
  assert.equal(none.code, 2);
  assert.equal(
    none.stderr.split('\n')[0],
    'ask-jev: no API key, so Jev was not called. Set TYPESAFE_API_KEY, or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or AI_GATEWAY_API_KEY in the environment that starts the agent.',
  );
});

test('cloudflare nests the request under input and unwraps the result envelope', async () => {
  const cwd = project({ 'a.ts': 'a' });
  const request = { state: 'payouts failing', questions: { urgent: { type: 'noul', instructions: 'Is it urgent?' } } };
  writeFileSync(join(cwd, 'req.json'), JSON.stringify(request));
  const evaluation = { model: 'jev-1.13.0', answers: { urgent: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } };
  const jev = fakeJev({
    responses: [ok({ result: { state: 'Completed', result: evaluation, gatewayMetadata: {} }, success: true, errors: [], messages: [] })],
  });

  const result = await run(['ask', '--provider', 'cloudflare', 'req.json'], {
    cwd,
    jev,
    env: { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct123' },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(jev.requests[0].body, { model: 'typesafe/jev', input: request });
  assert.deepEqual(JSON.parse(result.stdout), evaluation);
});

test('an explicit provider requires all of its variables', async () => {
  const cwd = project({ 'a.ts': 'a' });

  const result = await run(['files', '--goal', 'x', '--provider', 'cloudflare', 'a.ts'], { cwd, env: { CLOUDFLARE_API_TOKEN: 'cf-token', TYPESAFE_API_KEY: 'ts' } });

  assert.equal(result.code, 2);
  assert.equal(result.stderr.split('\n')[0], 'ask-jev: no API key, so Jev was not called. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment that starts the agent.');
});

test('refuses more than 300 candidates and asks to narrow', async () => {
  const files = {};
  for (let i = 0; i < 301; i++) files[`many/f${i}.txt`] = 'x';
  const cwd = project(files);

  const result = await run(['files', '--goal', 'x', 'many'], { cwd });

  assert.equal(result.code, 2);
  assert.equal(result.requests.length, 0);
  assert.equal(
    result.stderr.split('\n')[0],
    "ask-jev: 301 candidate files; ask-jev scores at most 300. Narrow the paths: a subdirectory, a glob such as 'src/**/*.ts', or the files from rg -l <term>.",
  );
});

test('rejects invalid file relevance probabilities instead of ranking them', async () => {
  const cwd = project({ 'a.ts': 'a' });
  for (const score of [-0.1, 1.1]) {
    const result = await run(['files', '--goal', 'x', 'a.ts'], { cwd, jev: fakeJev({ scoreOf: () => score }) });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid noul/);
  }
});
