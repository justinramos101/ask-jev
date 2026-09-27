import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  analyzeTelemetry,
  assessRun,
  buildSkillsOverride,
  normalizeDocument,
  parseCatalog,
  parseCli,
  redactSecrets,
  runProcess,
  selectCases,
  summarizeRuns,
  validateCasePath,
  validateSpec,
  verifyCatalog,
} from '../harness/triggers/run.mjs';

const SKILLS = ['ask-jev', 'jev-check-evidence', 'jev-semantic-lint'];

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'trigger-harness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeSkillTree(root, bodies = {}) {
  for (const name of SKILLS) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), bodies[name] ?? `---\nname: ${name}\n---\n\n# ${name}\nFull body.\n`);
  }
}

function validSpec() {
  return {
    skills: SKILLS,
    cases: [{
      id: 'choice',
      split: 'development',
      prompt: 'Choose an approach.',
      files: { 'notes.md': 'context' },
      required: ['ask-jev'],
      allowed: ['ask-jev'],
    }],
  };
}

function lines(...events) {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

function completedCommand(id, command, output, overrides = {}) {
  return {
    type: 'item.completed',
    item: {
      id,
      type: 'command_execution',
      command,
      aggregated_output: output,
      exit_code: 0,
      status: 'completed',
      ...overrides,
    },
  };
}

function turnCompleted() {
  return { type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 } };
}

function telemetryFixture(t, bodies = {}) {
  const cwd = temporary(t);
  const skillDocs = {};
  for (const name of SKILLS) {
    const body = bodies[name] ?? `---\nname: ${name}\n---\n\n# ${name}\nComplete document.\n`;
    const path = join(cwd, '.agents', 'skills', name, 'SKILL.md');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    skillDocs[name] = { path, body };
  }
  return { cwd, skillDocs };
}

test('CLI requires a model and validates bounded numeric options', () => {
  assert.throws(() => parseCli([]), /--model is required/);
  assert.throws(() => parseCli(['--model', 'gpt-5', '--repeat', '0']), /positive integer/);
  assert.deepEqual(parseCli(['--model', 'gpt-5', '--split', 'all', '--cases', 'choice,plain', '--timeout-seconds', '7']), {
    model: 'gpt-5', effort: 'medium', split: 'all', caseIds: ['choice', 'plain'], repeat: 1, timeoutSeconds: 7, root: undefined,
  });
});

test('spec validation accepts the domain shape and selection fails closed', (t) => {
  const skillRoot = temporary(t);
  makeSkillTree(skillRoot);
  const parsed = validateSpec(validSpec(), skillRoot);
  assert.equal(parsed.cases[0].id, 'choice');
  assert.deepEqual(selectCases(parsed.cases, { split: 'development' }).map(({ id }) => id), ['choice']);
  assert.throws(() => selectCases(parsed.cases, { split: 'holdout' }), /no cases selected/);
  assert.throws(() => selectCases(parsed.cases, { split: 'all', caseIds: ['missing'] }), /unknown case IDs/);
});

test('repository cases cover a positive and an excluded negative for every repository skill', () => {
  const raw = JSON.parse(readFileSync(new URL('../harness/triggers/cases.json', import.meta.url), 'utf8'));
  const spec = validateSpec(raw);
  for (const skill of spec.skills) {
    assert.ok(spec.cases.some(({ required }) => required.includes(skill)), `${skill} has no required positive`);
    assert.ok(spec.cases.some(({ allowed }) => !allowed.includes(skill)), `${skill} has no excluded negative`);
  }
});

test('spec validation rejects dependency omissions and unsafe fixture paths', (t) => {
  const skillRoot = temporary(t);
  makeSkillTree(skillRoot);
  const dependency = validSpec();
  dependency.cases[0].required = ['jev-check-evidence'];
  dependency.cases[0].allowed = ['jev-check-evidence'];
  assert.throws(() => validateSpec(dependency, skillRoot), /also require ask-jev/);
  for (const path of ['../secret', '/absolute', '.agents/skills/x', '.AGENTS/skills/x', '.codex/config.toml', '.git/config', 'nested/AGENTS.md']) {
    assert.throws(() => validateCasePath(path), /invalid|unsafe|agent configuration/);
  }
  assert.equal(validateCasePath('unit-test.md'), 'unit-test.md');
  assert.equal(validateCasePath('src/guide.md'), 'src/guide.md');
});

test('catalog parser resolves aliases and filtered verification requires only installed skills', (t) => {
  const root = temporary(t);
  const project = join(root, 'project');
  const external = join(root, 'external');
  makeSkillTree(join(project, '.agents', 'skills'));
  makeSkillTree(external);
  mkdirSync(join(external, 'setup-xstack'), { recursive: true });
  writeFileSync(join(external, 'setup-xstack', 'SKILL.md'), 'plugin body');
  const prompt = [{ content: [{ type: 'text', text: [
    '### Skill roots',
    `- \`r0\` = \`${join(project, '.agents', 'skills')}\``,
    `- \`r1\` = \`${external}\``,
    '### Available skills',
    '- ask-jev: local (file: r0/ask-jev/SKILL.md)',
    '- jev-check-evidence: local (file: r0/jev-check-evidence/SKILL.md)',
    '- jev-semantic-lint: local (file: r0/jev-semantic-lint/SKILL.md)',
    '- ask-jev: external (file: r1/ask-jev/SKILL.md)',
    '- xstack:setup-xstack: external plugin (file: r1/setup-xstack/SKILL.md)',
  ].join('\n') }] }];
  const entries = parseCatalog(JSON.stringify(prompt));
  assert.equal(entries.length, 5);
  const override = buildSkillsOverride(entries, project);
  assert.match(override, /enabled=false/);
  assert.match(override, new RegExp(external.replaceAll('/', '\\/')));
  const local = entries.filter(({ path }) => path.includes(`${join(project, '.agents', 'skills')}/`));
  const expected = Object.fromEntries(SKILLS.map((name) => [name, join(project, '.agents', 'skills', name, 'SKILL.md')]));
  assert.equal(verifyCatalog(local, expected).length, 3);
  assert.throws(() => parseCatalog(JSON.stringify([{ content: [{ type: 'text', text: '- broken (file: r9/x/SKILL.md)' }] }])), /unparsed/);
});

test('full completed read is evidence while echo, listing, and self-report are not', (t) => {
  const { cwd, skillDocs } = telemetryFixture(t);
  const path = skillDocs['ask-jev'].path;
  const stdout = lines(
    completedCommand('read', `/bin/zsh -lc "sed -n '1,240p' '${path}'"`, skillDocs['ask-jev'].body),
    completedCommand('echo', `echo '${skillDocs['jev-check-evidence'].path}'`, skillDocs['jev-check-evidence'].path),
    completedCommand('list', `ls '${skillDocs['jev-semantic-lint'].path}'`, skillDocs['jev-semantic-lint'].path),
    { type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'I loaded jev-semantic-lint.' } },
    turnCompleted(),
  );
  const result = analyzeTelemetry(stdout, { cwd, skillDocs });
  assert.deepEqual(result.verifiedLoaded, [{ name: 'ask-jev', eventId: 'read' }]);
  assert.deepEqual(result.unverifiedReads, []);
  assert.equal(result.finalText, 'I loaded jev-semantic-lint.');
});

test('unattributed full body output is unverified rather than a clean negative', (t) => {
  const { cwd, skillDocs } = telemetryFixture(t);
  const stdout = lines(
    completedCommand('echo-body', `echo '${skillDocs['ask-jev'].path}'`, skillDocs['ask-jev'].body),
    completedCommand('glob-body', 'cat .agents/skills/*/SKILL.md', skillDocs['jev-check-evidence'].body),
    turnCompleted(),
  );
  const result = analyzeTelemetry(stdout, { cwd, skillDocs });
  assert.deepEqual(result.verifiedLoaded, []);
  assert.deepEqual(result.unverifiedReads, [
    { name: 'ask-jev', eventId: 'echo-body', reason: 'unattributed_body_exposure' },
    { name: 'jev-check-evidence', eventId: 'glob-body', reason: 'unattributed_body_exposure' },
  ]);
});

test('batched reads and CRLF output verify each complete document', (t) => {
  const bodies = {
    'ask-jev': 'alpha\r\nbeta\r\n',
    'jev-check-evidence': 'one\ntwo\n',
  };
  const { cwd, skillDocs } = telemetryFixture(t, bodies);
  const command = `/bin/zsh -lc "cat '${skillDocs['ask-jev'].path}' && sed -n '1,99p' '${skillDocs['jev-check-evidence'].path}'"`;
  const output = `${bodies['ask-jev'].replaceAll('\r\n', '\n')}${bodies['jev-check-evidence']}`;
  const result = analyzeTelemetry(lines(completedCommand('batch', command, output), turnCompleted()), { cwd, skillDocs });
  assert.deepEqual(result.verifiedLoaded.map(({ name }) => name), ['ask-jev', 'jev-check-evidence']);
  assert.equal(normalizeDocument('a\r\nb\r\n'), 'a\nb');
});

test('failed, started-only, truncated, unsupported, and wrong-path reads are unverified', (t) => {
  const { cwd, skillDocs } = telemetryFixture(t);
  const other = join(cwd, 'global', 'ask-jev', 'SKILL.md');
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, skillDocs['ask-jev'].body);
  const stdout = lines(
    completedCommand('failed', `cat '${skillDocs['ask-jev'].path}'`, '', { exit_code: 1, status: 'failed' }),
    { type: 'item.started', item: { id: 'started', type: 'command_execution', command: `head '${skillDocs['jev-check-evidence'].path}'`, status: 'in_progress' } },
    completedCommand('partial', `tail '${skillDocs['jev-semantic-lint'].path}'`, 'last line'),
    completedCommand('unknown', `python -c read '${skillDocs['ask-jev'].path}'`, skillDocs['ask-jev'].body),
    completedCommand('wrong', `cat '${other}'`, skillDocs['ask-jev'].body),
    turnCompleted(),
  );
  const result = analyzeTelemetry(stdout, { cwd, skillDocs });
  assert.deepEqual(result.verifiedLoaded, []);
  assert.deepEqual(new Set(result.unverifiedReads.map(({ reason }) => reason)), new Set(['failed_read', 'started_only', 'partial_output', 'unsupported_reader', 'wrong_path']));
});

test('a skill path inside a heredoc request is not treated as a read', (t) => {
  const { cwd, skillDocs } = telemetryFixture(t);
  const command = `cat <<'EOF' > request.md\nplease read ${skillDocs['ask-jev'].path}\nEOF`;
  const result = analyzeTelemetry(lines(completedCommand('write', command, ''), turnCompleted()), { cwd, skillDocs });
  assert.deepEqual(result.verifiedLoaded, []);
  assert.deepEqual(result.unverifiedReads, []);
});

test('route assessment rejects overtrigger, missing dependency, timeout, malformed, and missing completion', (t) => {
  const { cwd, skillDocs } = telemetryFixture(t);
  const output = `${skillDocs['jev-check-evidence'].body}\n${skillDocs['ask-jev'].body}`;
  const command = `cat '${skillDocs['jev-check-evidence'].path}' '${skillDocs['ask-jev'].path}'`;
  const telemetry = analyzeTelemetry(lines(completedCommand('both', command, output), turnCompleted()), { cwd, skillDocs });
  const clean = { code: 0, timedOut: false, spawnError: undefined };
  assert.deepEqual(assessRun(clean, telemetry, { required: [], allowed: [] }).unexpected.sort(), ['ask-jev', 'jev-check-evidence']);

  const specializationOnly = analyzeTelemetry(lines(completedCommand('one', `cat '${skillDocs['jev-check-evidence'].path}'`, skillDocs['jev-check-evidence'].body), turnCompleted()), { cwd, skillDocs });
  const dependency = assessRun(clean, specializationOnly, { required: ['ask-jev', 'jev-check-evidence'], allowed: ['ask-jev', 'jev-check-evidence'] });
  assert.deepEqual(dependency.missing, ['ask-jev']);
  assert.equal(dependency.routePass, false);

  const timedOut = assessRun({ ...clean, timedOut: true }, telemetry, { required: [], allowed: SKILLS });
  assert.equal(timedOut.status, 'timed_out');
  assert.equal(timedOut.routePass, false);
  assert.equal(telemetry.verifiedLoaded.length, 2);

  const malformed = analyzeTelemetry(`${lines(turnCompleted())}not-json\n`, { cwd, skillDocs });
  assert.equal(assessRun(clean, malformed, { required: [], allowed: [] }).status, 'malformed_telemetry');
  const incomplete = analyzeTelemetry(lines({ type: 'turn.started' }), { cwd, skillDocs });
  assert.equal(assessRun(clean, incomplete, { required: [], allowed: [] }).status, 'missing_completion');
});

test('summary counts runtime failures as failures instead of successful negatives', () => {
  const base = { required: [], allowed: [], verifiedLoadedNames: [], routePass: false };
  const summary = summarizeRuns([
    { ...base, status: 'timed_out' },
    { ...base, status: 'completed', routePass: true },
  ], ['ask-jev']);
  assert.deepEqual(summary.perSkill['ask-jev'].negatives, { passed: 1, total: 2 });
  assert.deepEqual(summary.failureStatuses, { timed_out: 1 });
  assert.equal(summary.completionRate, 0.5);
});

test('subprocess wrapper reports spawn failure and bounds a process group timeout', async () => {
  const missing = await runProcess(`missing-command-${Date.now()}`, [], { timeoutMs: 500 });
  assert.equal(missing.code, null);
  assert.match(missing.spawnError, /ENOENT/);

  const timeout = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 40, killGraceMs: 40 });
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.code, null);
  assert.ok(timeout.wallMs < 2_000);
});

test('secret values are redacted without reading credential files', () => {
  const text = redactSecrets('type=secret-a gateway=secret-b', { TYPESAFE_API_KEY: 'secret-a', AI_GATEWAY_API_KEY: 'secret-b' });
  assert.equal(text, 'type=[redacted:TYPESAFE_API_KEY] gateway=[redacted:AI_GATEWAY_API_KEY]');
});

test('runner diagnostics recognize quoted executable paths without counting mentions or reads', (t) => {
  const { cwd, skillDocs } = telemetryFixture(t);
  const script = join(cwd, '.agents', 'skills', 'ask-jev', 'scripts', 'ask-jev.mjs');
  const stdout = lines(
    completedCommand('call', `/bin/zsh -lc "node '${script}' ask request.json"`, '{}'),
    completedCommand('read', `cat '${script}'`, 'source'),
    completedCommand('mention', `echo '${script}'`, script),
    turnCompleted(),
  );
  const result = analyzeTelemetry(stdout, { cwd, skillDocs });
  assert.deepEqual(result.runnerAttempts, [{ eventId: 'call', exitCode: 0, status: 'completed' }]);
});
