#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_CASES = join(HERE, 'cases.json');
const SPLITS = new Set(['development', 'holdout', 'all']);
const CASE_SPLITS = new Set(['development', 'holdout']);
const READERS = new Set(['cat', 'sed', 'head', 'tail', 'nl', 'bat']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

export function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      model: { type: 'string' },
      effort: { type: 'string', default: 'medium' },
      split: { type: 'string', default: 'development' },
      cases: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      'timeout-seconds': { type: 'string', default: '180' },
      root: { type: 'string' },
    },
  });
  if (positionals.length) throw new Error(`unexpected positional arguments: ${positionals.join(', ')}`);
  if (!values.model?.trim()) throw new Error('--model is required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(values.model)) throw new Error('invalid --model');
  if (!/^[a-z][a-z0-9_-]*$/i.test(values.effort)) throw new Error('invalid --effort');
  if (!SPLITS.has(values.split)) throw new Error('--split must be development, holdout, or all');
  const repeat = positiveInteger(values.repeat, '--repeat');
  const timeoutSeconds = positiveInteger(values['timeout-seconds'], '--timeout-seconds');
  const caseIds = values.cases === undefined ? undefined : parseCaseIds(values.cases);
  return {
    model: values.model,
    effort: values.effort,
    split: values.split,
    caseIds,
    repeat,
    timeoutSeconds,
    root: values.root ? resolve(values.root) : undefined,
  };
}

function positiveInteger(value, option) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${option} must be a positive integer`);
  }
  return Number(value);
}

function parseCaseIds(value) {
  const ids = value.split(',').map((id) => id.trim());
  if (!ids.length || ids.some((id) => !id)) throw new Error('--cases must contain comma-separated case IDs');
  if (new Set(ids).size !== ids.length) throw new Error('--cases contains duplicate IDs');
  return ids;
}

export function validateSpec(raw, skillRoot = join(REPO, 'skills')) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('cases file must contain an object');
  if (!Array.isArray(raw.skills) || raw.skills.length === 0) throw new Error('cases file must name at least one skill');
  const skills = raw.skills.map((name, index) => validateName(name, `skills[${index}]`));
  if (new Set(skills).size !== skills.length) throw new Error('skill names must be unique');
  const repositorySkills = readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
  const declaredSkills = [...skills].sort();
  if (JSON.stringify(repositorySkills) !== JSON.stringify(declaredSkills)) {
    throw new Error(`declared skills do not match repository skills: declared=${declaredSkills.join(',')} repository=${repositorySkills.join(',')}`);
  }
  const skillSet = new Set(skills);
  const skillSources = Object.fromEntries(skills.map((name) => {
    const source = resolve(skillRoot, name);
    const doc = join(source, 'SKILL.md');
    if (!existsSync(doc)) throw new Error(`missing skill document: ${doc}`);
    return [name, { source, doc, body: readFileSync(doc, 'utf8') }];
  }));
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error('cases must be a nonempty array');
  const seen = new Set();
  const cases = raw.cases.map((item, index) => validateCase(item, index, skillSet));
  for (const item of cases) {
    if (seen.has(item.id)) throw new Error(`duplicate case ID: ${item.id}`);
    seen.add(item.id);
  }
  return { skills, skillSources, cases };
}

function validateName(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function validateCase(raw, index, skillSet) {
  const label = `cases[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  const id = validateName(raw.id, `${label}.id`);
  if (!CASE_SPLITS.has(raw.split)) throw new Error(`${id}: split must be development or holdout`);
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) throw new Error(`${id}: prompt must be nonempty`);
  if (!raw.files || typeof raw.files !== 'object' || Array.isArray(raw.files)) throw new Error(`${id}: files must be an object`);
  const files = {};
  for (const [path, content] of Object.entries(raw.files)) {
    validateCasePath(path, id);
    if (typeof content !== 'string') throw new Error(`${id}: ${path} content must be a string`);
    files[path] = content;
  }
  const required = validateSkillList(raw.required, `${id}.required`, skillSet);
  const allowed = validateSkillList(raw.allowed, `${id}.allowed`, skillSet);
  if (required.some((name) => !allowed.includes(name))) throw new Error(`${id}: required must be a subset of allowed`);
  if (required.some((name) => name !== 'ask-jev') && !required.includes('ask-jev')) {
    throw new Error(`${id}: specialization positives must also require ask-jev`);
  }
  return { id, split: raw.split, prompt: raw.prompt, files, required, allowed };
}

function validateSkillList(value, label, skillSet) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const names = value.map((name, index) => validateName(name, `${label}[${index}]`));
  if (new Set(names).size !== names.length) throw new Error(`${label} contains duplicates`);
  for (const name of names) if (!skillSet.has(name)) throw new Error(`${label} contains unknown skill ${name}`);
  return names;
}

export function validateCasePath(path, caseId = 'case') {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) {
    throw new Error(`${caseId}: invalid file path ${JSON.stringify(path)}`);
  }
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`${caseId}: unsafe file path ${path}`);
  if (['.agents', '.codex', '.git'].includes(parts[0].toLowerCase()) || parts.some((part) => part.toLowerCase() === 'agents.md')) {
    throw new Error(`${caseId}: file path may not inject agent configuration`);
  }
  return path;
}

export function selectCases(cases, { split, caseIds }) {
  if (caseIds) {
    const known = new Set(cases.map(({ id }) => id));
    const unknown = caseIds.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`unknown case IDs: ${unknown.join(', ')}`);
  }
  const wanted = caseIds ? new Set(caseIds) : undefined;
  const selected = cases.filter((item) => (split === 'all' || item.split === split) && (!wanted || wanted.has(item.id)));
  if (!selected.length) throw new Error('no cases selected');
  return selected;
}

export function parseCatalog(stdout, realpath = realpathSync.native) {
  let blocks;
  try {
    blocks = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`catalog output is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(blocks)) throw new Error('catalog output must be a JSON array');
  const text = blocks.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((block) => block && typeof block === 'object' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
  const roots = new Map([...text.matchAll(/^-\s+`(r\d+)`\s*=\s*`([^`]+)`\s*$/gm)].map((match) => [match[1], match[2]]));
  const fileLines = text.split('\n').filter((line) => line.includes('(file:') && line.includes('SKILL.md'));
  const entries = [];
  const unparsed = [];
  for (const line of fileLines) {
    const match = line.match(/^\s*-\s+([a-z0-9][a-z0-9:-]*):.*\(file:\s*([^()]*?SKILL\.md)\)\s*$/i);
    if (!match) {
      unparsed.push(line.trim());
      continue;
    }
    const [, name, reference] = match;
    let path;
    const alias = reference.match(/^(r\d+)\/(.+)$/);
    if (alias) {
      const root = roots.get(alias[1]);
      if (!root) {
        unparsed.push(line.trim());
        continue;
      }
      path = join(root, alias[2]);
    } else if (isAbsolute(reference)) {
      path = reference;
    } else {
      unparsed.push(line.trim());
      continue;
    }
    try {
      entries.push({ name, path: realpath(path) });
    } catch {
      unparsed.push(line.trim());
    }
  }
  if (unparsed.length) throw new Error(`unparsed catalog entries: ${unparsed.join(' | ')}`);
  if (!entries.length) throw new Error('catalog contains no parsed skill entries');
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.name}\0${entry.path}`;
    if (seen.has(key)) throw new Error(`colliding catalog entry: ${entry.name} at ${entry.path}`);
    seen.add(key);
  }
  return entries;
}

export function buildSkillsOverride(entries, project) {
  const canonicalProject = realpathSync.native(project);
  const prefix = canonicalProject.endsWith(sep) ? canonicalProject : `${canonicalProject}${sep}`;
  const external = [...new Set(entries.map(({ path }) => path).filter((path) => !path.startsWith(prefix)))];
  return `skills.config=[${external.map((path) => `{path=${JSON.stringify(path)},enabled=false}`).join(',')}]`;
}

export function verifyCatalog(entries, expected) {
  const expectedEntries = Object.entries(expected).map(([name, path]) => ({ name, path: realpathSync.native(path) }));
  const collisions = entries.filter((entry, index) => entries.findIndex((other) => other.name === entry.name || other.path === entry.path) !== index);
  if (collisions.length) throw new Error(`colliding filtered catalog: ${collisions.map(({ name, path }) => `${name} at ${path}`).join(', ')}`);
  if (entries.length !== expectedEntries.length) {
    throw new Error(`filtered catalog has ${entries.length} entries; expected ${expectedEntries.length}`);
  }
  for (const wanted of expectedEntries) {
    const matches = entries.filter((entry) => entry.name === wanted.name && entry.path === wanted.path);
    if (matches.length !== 1) throw new Error(`filtered catalog does not contain exactly one ${wanted.name} at ${wanted.path}`);
  }
  return entries;
}

export function normalizeDocument(value) {
  return String(value).replaceAll('\r\n', '\n').trim();
}

export function shellTokens(source) {
  const tokens = [];
  let token = '';
  let quote = '';
  let escaped = false;
  const push = () => {
    if (token) tokens.push({ type: 'word', value: token });
    token = '';
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      if (char === '\n') tokens.push({ type: 'operator', value: '\n' });
      continue;
    }
    if (';&|()'.includes(char)) {
      push();
      let value = char;
      if (';&|'.includes(char) && source[index + 1] === char) value += source[++index];
      tokens.push({ type: 'operator', value });
      continue;
    }
    token += char;
  }
  push();
  return tokens;
}

function commandSegments(source, depth = 0) {
  if (depth > 3) return [];
  const tokens = shellTokens(stripHeredocBodies(source));
  const segments = [];
  let current = [];
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (const token of tokens) {
    if (token.type === 'operator') flush();
    else current.push(token.value);
  }
  flush();
  return segments.flatMap((segment) => {
    const command = basename(segment[0] ?? '');
    if (!SHELLS.has(command)) return [segment];
    const flag = segment.findIndex((part, index) => index > 0 && /^-[a-z]*c[a-z]*$/i.test(part));
    return flag >= 0 && segment[flag + 1] ? commandSegments(segment[flag + 1], depth + 1) : [segment];
  });
}

function stripHeredocBodies(source) {
  const lines = source.split('\n');
  const kept = [];
  let delimiter;
  for (const line of lines) {
    if (delimiter) {
      if (line.trim() === delimiter) delimiter = undefined;
      continue;
    }
    kept.push(line);
    const match = line.match(/<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/);
    if (match) delimiter = match[1];
  }
  return kept.join('\n');
}

function pathToken(token, cwd) {
  if (!token || token.startsWith('-') || /[*?$`]/.test(token)) return undefined;
  try {
    return realpathSync.native(isAbsolute(token) ? token : resolve(cwd, token));
  } catch {
    return undefined;
  }
}

function readReferences(command, cwd) {
  return commandSegments(command).flatMap((segment) => {
    let index = 0;
    while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) index++;
    if (segment[index] === 'command') index++;
    const reader = basename(segment[index] ?? '');
    if (!isRecognizedReader(segment, index)) return [];
    return segment.slice(index + 1).map((token) => ({ reader, token, path: pathToken(token, cwd) })).filter(({ path }) => path);
  });
}

function isRecognizedReader(segment, commandIndex) {
  const reader = basename(segment[commandIndex] ?? '');
  if (!READERS.has(reader)) return false;
  if (reader !== 'sed') return true;
  return segment.slice(commandIndex + 1).some((token) => token === '-n' || /^-[^-]*n/.test(token));
}

function mentionedSkillPaths(command, skillNames, cwd) {
  const found = [];
  for (const segment of commandSegments(command)) {
    let index = 0;
    while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) index++;
    if (segment[index] === 'command') index++;
    const commandName = basename(segment[index] ?? '');
    if (commandName === 'echo' || commandName === 'printf' || commandName === 'ls' || commandName === 'find') continue;
    for (const token of segment.slice(index + 1)) {
      for (const name of skillNames) {
        if (token.replaceAll('\\', '/').endsWith(`/${name}/SKILL.md`)) {
          found.push({ name, token, path: pathToken(token, cwd), recognizedReader: isRecognizedReader(segment, index) });
        }
      }
    }
  }
  return found;
}

export function parseJsonEvents(stdout) {
  const events = [];
  const malformed = [];
  for (const [index, line] of stdout.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) malformed.push(index + 1);
      else events.push(event);
    } catch {
      malformed.push(index + 1);
    }
  }
  return { events, malformed };
}

export function analyzeTelemetry(stdout, { cwd, skillDocs }) {
  const { events, malformed } = parseJsonEvents(stdout);
  const expected = Object.fromEntries(Object.entries(skillDocs).map(([name, doc]) => [name, {
    path: realpathSync.native(doc.path),
    body: normalizeDocument(doc.body),
  }]));
  const verified = new Map();
  const unverified = [];
  const runnerAttempts = [];
  const completedIds = new Set();
  let finalText = '';
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0 };
  const observedModels = new Set();
  let turnCompleted = false;
  let turnFailed = false;
  for (const event of events) {
    for (const model of [event.model, event.item?.model, event.response?.model]) {
      if (typeof model === 'string' && model) observedModels.add(model);
    }
    if (event.type === 'turn.completed') {
      turnCompleted = true;
      usage.input += event.usage?.input_tokens ?? 0;
      usage.cached += event.usage?.cached_input_tokens ?? 0;
      usage.output += event.usage?.output_tokens ?? 0;
      usage.reasoning += event.usage?.reasoning_output_tokens ?? 0;
    }
    if (event.type === 'turn.failed') turnFailed = true;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalText = String(event.item.text ?? '');
    if (event.type !== 'item.completed' || event.item?.type !== 'command_execution') continue;
    const item = event.item;
    completedIds.add(item.id);
    const command = String(item.command ?? '');
    const runnerCommand = commandSegments(command).some((segment) => {
      let index = 0;
      while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) index++;
      if (segment[index] === 'command') index++;
      const executable = basename(segment[index] ?? '');
      return executable === 'ask-jev.mjs'
        || (['node', 'nodejs', 'bun'].includes(executable) && segment.slice(index + 1).some((part) => basename(part) === 'ask-jev.mjs'));
    });
    if (runnerCommand) {
      runnerAttempts.push({ eventId: item.id, exitCode: item.exit_code ?? null, status: item.status ?? null });
    }
    const refs = readReferences(command, cwd);
    const output = normalizeDocument(item.aggregated_output ?? '');
    const verifiedHere = new Set();
    for (const [name, doc] of Object.entries(expected)) {
      const exact = refs.some(({ path }) => path === doc.path);
      if (!exact) continue;
      if (item.status === 'completed' && item.exit_code === 0 && output.includes(doc.body)) {
        verifiedHere.add(name);
        if (!verified.has(name)) verified.set(name, item.id);
      } else {
        unverified.push({ name, eventId: item.id, reason: item.exit_code === 0 ? 'partial_output' : 'failed_read' });
      }
    }
    for (const mention of mentionedSkillPaths(command, Object.keys(expected), cwd)) {
      if (mention.recognizedReader) {
        if (mention.path !== expected[mention.name].path) unverified.push({ name: mention.name, eventId: item.id, reason: 'wrong_path' });
      } else if (mention.path === expected[mention.name].path) {
        unverified.push({ name: mention.name, eventId: item.id, reason: 'unsupported_reader' });
      }
    }
    for (const [name, doc] of Object.entries(expected)) {
      if (!output.includes(doc.body) || verifiedHere.has(name)) continue;
      if (!unverified.some((read) => read.name === name && read.eventId === item.id)) {
        unverified.push({ name, eventId: item.id, reason: 'unattributed_body_exposure' });
      }
    }
  }
  for (const event of events) {
    if (event.type !== 'item.started' || event.item?.type !== 'command_execution' || completedIds.has(event.item.id)) continue;
    const refs = readReferences(String(event.item.command ?? ''), cwd);
    for (const [name, doc] of Object.entries(expected)) {
      if (refs.some(({ path }) => path === doc.path)) unverified.push({ name, eventId: event.item.id, reason: 'started_only' });
    }
  }
  return {
    malformedLines: malformed,
    turnCompleted,
    turnFailed,
    verifiedLoaded: [...verified].map(([name, eventId]) => ({ name, eventId })),
    unverifiedReads: dedupeRecords(unverified),
    runnerAttempts,
    finalText,
    usage,
    observedModels: [...observedModels],
    eventCount: events.length,
  };
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function assessRun(outcome, telemetry, testCase) {
  let status = 'completed';
  if (outcome.timedOut) status = 'timed_out';
  else if (outcome.spawnError) status = 'spawn_error';
  else if (outcome.code !== 0 || telemetry.turnFailed) status = 'failed';
  else if (telemetry.malformedLines.length) status = 'malformed_telemetry';
  else if (!telemetry.turnCompleted) status = 'missing_completion';
  else if (telemetry.unverifiedReads.length) status = 'unverified_reads';
  const loaded = telemetry.verifiedLoaded.map(({ name }) => name);
  const missing = testCase.required.filter((name) => !loaded.includes(name));
  const unexpected = loaded.filter((name) => !testCase.allowed.includes(name));
  const routePass = status === 'completed' && missing.length === 0 && unexpected.length === 0;
  return { status, routePass, missing, unexpected };
}

export function redactSecrets(text, env = process.env) {
  let redacted = String(text);
  for (const name of ['TYPESAFE_API_KEY', 'AI_GATEWAY_API_KEY']) {
    const value = env[name];
    if (value) redacted = redacted.replaceAll(value, `[redacted:${name}]`);
  }
  return redacted;
}

export function runProcess(command, args, { cwd, env = process.env, timeoutMs, killGraceMs = 2_000 } = {}) {
  return new Promise((resolveOutcome) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let spawnError;
    let forceTimer;
    let fallbackTimer;
    const detached = process.platform !== 'win32';
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceTimer);
      clearTimeout(fallbackTimer);
      resolveOutcome({ code, signal, stdout, stderr, timedOut, spawnError, wallMs: Date.now() - started });
    };
    let child;
    try {
      child = spawn(command, args, { cwd, env, detached, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolveOutcome({ code: null, signal: null, stdout, stderr, timedOut, spawnError: error.message, wallMs: Date.now() - started });
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.once('close', finish);
    const kill = (signal) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      forceTimer = setTimeout(() => {
        kill('SIGKILL');
        fallbackTimer = setTimeout(() => finish(null, 'SIGKILL'), killGraceMs);
      }, killGraceMs);
    }, timeoutMs);
  });
}

export function summarizeRuns(runs, skills) {
  const total = runs.length;
  const completed = runs.filter((run) => run.status === 'completed').length;
  const routePassed = runs.filter((run) => run.routePass).length;
  const perSkill = Object.fromEntries(skills.map((skill) => {
    const positives = runs.filter((run) => run.required.includes(skill));
    const negatives = runs.filter((run) => !run.allowed.includes(skill));
    return [skill, {
      positives: { passed: positives.filter((run) => run.status === 'completed' && run.verifiedLoadedNames.includes(skill)).length, total: positives.length },
      negatives: { passed: negatives.filter((run) => run.status === 'completed' && !run.verifiedLoadedNames.includes(skill)).length, total: negatives.length },
    }];
  }));
  const failureStatuses = {};
  for (const run of runs.filter((item) => item.status !== 'completed')) {
    failureStatuses[run.status] = (failureStatuses[run.status] ?? 0) + 1;
  }
  return { total, completed, routePassed, completionRate: total ? completed / total : 0, perSkill, failureStatuses };
}

export function renderMarkdown(report) {
  const pct = (value, total) => total ? `${Math.round(value * 100 / total)}% (${value}/${total})` : 'n/a (0/0)';
  const lines = [
    '# Trigger routing run',
    '',
    `Requested model: ${report.request.model}. Observed model metadata: ${report.observedModels.join(', ') || 'not emitted'}. Codex: ${report.codexVersion}.`,
    '',
    `Completed: ${pct(report.summary.completed, report.summary.total)}. Exact routes: ${pct(report.summary.routePassed, report.summary.total)}.`,
    '',
    '| skill | positive load rate | negative absence rate |',
    '| --- | ---: | ---: |',
  ];
  for (const [name, rates] of Object.entries(report.summary.perSkill)) {
    lines.push(`| ${name} | ${pct(rates.positives.passed, rates.positives.total)} | ${pct(rates.negatives.passed, rates.negatives.total)} |`);
  }
  lines.push('', '| case | repeat | split | status | loaded | missing | unexpected | wall s |', '| --- | ---: | --- | --- | --- | --- | --- | ---: |');
  for (const run of report.runs) {
    lines.push(`| ${run.caseId} | ${run.repeat} | ${run.split} | ${run.routePass ? 'pass' : run.status === 'completed' ? 'mismatch' : run.status} | ${run.verifiedLoadedNames.join(', ') || 'none'} | ${run.missing.join(', ') || 'none'} | ${run.unexpected.join(', ') || 'none'} | ${(run.wallMs / 1000).toFixed(1)} |`);
  }
  if (Object.keys(report.summary.failureStatuses).length) {
    lines.push('', 'Failures:', '');
    for (const [status, count] of Object.entries(report.summary.failureStatuses)) lines.push(`- ${status}: ${count}`);
  }
  return `${lines.join('\n')}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashDirectory(root) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const rel = relative(root, path).split(sep).join('/');
      const stat = lstatSync(path);
      hash.update(`${stat.isDirectory() ? 'd' : stat.isSymbolicLink() ? 'l' : 'f'}\0${rel}\0`);
      if (stat.isDirectory()) visit(path);
      else if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function caseHashes(testCase) {
  return {
    prompt: sha256(testCase.prompt),
    files: Object.fromEntries(Object.entries(testCase.files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => [path, sha256(content)])),
  };
}

function nextProject(root) {
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  let number = 1;
  while (true) {
    const project = join(work, `project-${number}`);
    try {
      mkdirSync(project);
      return { project, number };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      number++;
    }
  }
}

function prepareProject(root, spec, testCase) {
  const { project, number } = nextProject(root);
  const installed = {};
  for (const skill of spec.skills) {
    const destination = join(project, '.agents', 'skills', skill);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(spec.skillSources[skill].source, destination, { recursive: true });
    installed[skill] = join(destination, 'SKILL.md');
  }
  for (const [path, content] of Object.entries(testCase.files)) {
    const destination = join(project, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return { project, number, installed };
}

async function readCatalog(project, override, timeoutMs) {
  const args = ['debug', 'prompt-input'];
  if (override !== undefined) args.push('-c', override);
  args.push('List the filenames in this directory.');
  const outcome = await runProcess('codex', args, { cwd: project, timeoutMs });
  if (outcome.timedOut) throw new Error('catalog probe timed out');
  if (outcome.spawnError) throw new Error(`catalog probe failed to spawn: ${outcome.spawnError}`);
  if (outcome.code !== 0) throw new Error(`catalog probe exited ${outcome.code}: ${redactSecrets(outcome.stderr).trim()}`);
  return parseCatalog(outcome.stdout);
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw new Error(`could not run ${command} ${args.join(' ')}`);
  return result.stdout.trim();
}

function stamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function nextArtifactDir(root) {
  const base = `run-${stamp()}`;
  let suffix = 1;
  while (true) {
    const directory = join(root, suffix === 1 ? base : `${base}-${suffix}`);
    try {
      mkdirSync(directory);
      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      suffix++;
    }
  }
}

async function executeCase({ root, artifactDir, spec, testCase, repeat, request }) {
  const { project, number, installed } = prepareProject(root, spec, testCase);
  const timeoutMs = request.timeoutSeconds * 1000;
  const initialCatalog = await readCatalog(project, undefined, timeoutMs);
  const override = buildSkillsOverride(initialCatalog, project);
  const filteredCatalog = verifyCatalog(await readCatalog(project, override, timeoutMs), installed);
  const args = [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '-C', project, '-s', 'workspace-write', '-m', request.model,
    '-c', `model_reasoning_effort=${request.effort}`,
    '-c', 'sandbox_workspace_write.network_access=true',
    '-c', 'shell_environment_policy.inherit=all',
    '-c', override,
    testCase.prompt,
  ];
  const outcome = await runProcess('codex', args, { cwd: project, timeoutMs });
  const safeStdout = redactSecrets(outcome.stdout);
  const safeStderr = redactSecrets(outcome.stderr);
  const slug = `${String(number).padStart(3, '0')}-${testCase.id}-${repeat}`;
  writeFileSync(join(artifactDir, `${slug}.jsonl`), safeStdout);
  writeFileSync(join(artifactDir, `${slug}.stderr.txt`), safeStderr);
  const skillDocs = Object.fromEntries(spec.skills.map((name) => [name, { path: installed[name], body: spec.skillSources[name].body }]));
  const telemetry = analyzeTelemetry(safeStdout, { cwd: project, skillDocs });
  const assessment = assessRun(outcome, telemetry, testCase);
  return {
    caseId: testCase.id,
    split: testCase.split,
    repeat,
    project,
    promptHash: caseHashes(testCase).prompt,
    fileHashes: caseHashes(testCase).files,
    required: testCase.required,
    allowed: testCase.allowed,
    requestedModel: request.model,
    observedModels: telemetry.observedModels,
    status: assessment.status,
    routePass: assessment.routePass,
    missing: assessment.missing,
    unexpected: assessment.unexpected,
    verifiedLoadedNames: telemetry.verifiedLoaded.map(({ name }) => name),
    verifiedLoads: telemetry.verifiedLoaded,
    unverifiedReads: telemetry.unverifiedReads,
    runnerAttempts: telemetry.runnerAttempts,
    finalText: redactSecrets(telemetry.finalText),
    usage: telemetry.usage,
    wallMs: outcome.wallMs,
    exitCode: outcome.code,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    spawnError: outcome.spawnError,
    telemetry: { eventCount: telemetry.eventCount, malformedLines: telemetry.malformedLines, turnCompleted: telemetry.turnCompleted, turnFailed: telemetry.turnFailed },
    catalog: {
      initial: initialCatalog.map(({ name, path }) => ({ name, path, location: path.startsWith(realpathSync.native(project) + sep) ? 'project' : 'external' })),
      filtered: filteredCatalog,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const request = parseCli(argv);
  const caseSource = readFileSync(DEFAULT_CASES, 'utf8');
  const raw = JSON.parse(caseSource);
  const harnessHash = sha256(readFileSync(fileURLToPath(import.meta.url)));
  const casesHash = sha256(caseSource);
  const spec = validateSpec(raw);
  const selected = selectCases(spec.cases, request);
  const root = request.root ?? mkdtempSync(join(tmpdir(), 'ask-jev-triggers-'));
  mkdirSync(root, { recursive: true });
  const artifactDir = nextArtifactDir(root);
  const codexVersion = commandVersion('codex', ['--version']);
  const sourceGitSha = commandVersion('git', ['-C', REPO, 'rev-parse', 'HEAD']);
  const skillHashes = Object.fromEntries(spec.skills.map((name) => [name, {
    directory: hashDirectory(spec.skillSources[name].source),
    document: sha256(spec.skillSources[name].body),
  }]));
  const runs = [];
  for (const testCase of selected) {
    for (let repeat = 1; repeat <= request.repeat; repeat++) {
      try {
        const run = await executeCase({ root, artifactDir, spec, testCase, repeat, request });
        runs.push(run);
        process.stderr.write(`${testCase.id} #${repeat}: ${run.routePass ? 'pass' : run.status === 'completed' ? 'mismatch' : run.status}; loaded=${run.verifiedLoadedNames.join(',') || 'none'}\n`);
      } catch (error) {
        const run = {
          caseId: testCase.id,
          split: testCase.split,
          repeat,
          required: testCase.required,
          allowed: testCase.allowed,
          requestedModel: request.model,
          observedModels: [],
          status: 'failed',
          routePass: false,
          missing: testCase.required,
          unexpected: [],
          verifiedLoadedNames: [],
          verifiedLoads: [],
          unverifiedReads: [],
          runnerAttempts: [],
          finalText: '',
          usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
          wallMs: 0,
          error: redactSecrets(error?.stack ?? error),
        };
        runs.push(run);
        process.stderr.write(`${testCase.id} #${repeat}: failed; ${redactSecrets(error.message)}\n`);
      }
    }
  }
  const observedModels = [...new Set(runs.flatMap((run) => run.observedModels))];
  const report = {
    generatedAt: new Date().toISOString(),
    root,
    request,
    codexVersion,
    sourceGitSha,
    harnessHash,
    casesHash,
    skillHashes,
    observedModels,
    caseHashes: Object.fromEntries(selected.map((testCase) => [testCase.id, caseHashes(testCase)])),
    summary: summarizeRuns(runs, spec.skills),
    runs,
  };
  writeFileSync(join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = renderMarkdown(report);
  writeFileSync(join(artifactDir, 'report.md'), markdown);
  process.stdout.write(`${markdown}\nArtifacts: ${artifactDir}\n`);
  if (runs.some((run) => !run.routePass)) process.exitCode = 1;
  return report;
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`trigger runner: ${redactSecrets(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
