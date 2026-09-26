# File-discovery benchmark reference

`harness/run.mjs` compares Claude Code and Codex runs with and without the skill. It measures file-discovery behavior, not general decision quality. Historical reports in `results/` cover the original file-only skill.

## Fixture and tasks

`harness/tasks.json` specifies the Hono repository, tag, commit, installation command, and task prompts. The benchmark checks the cached fixture's commit before each invocation.

Tasks with `expectTrigger: true` ask where or how code works and list `answerFiles`. Other tasks name a file, include a snippet, ask about Git history, or request a command. These labels describe the file-discovery benchmark's expectations.

From the repository root, this command prints the current fixture and task counts:

```sh
node --input-type=module -e 'import { readFileSync } from "node:fs"; const { fixture, tasks } = JSON.parse(readFileSync("harness/tasks.json", "utf8")); console.log({ fixture, tasks: tasks.length, expectTrigger: tasks.filter(t => t.expectTrigger).length, noTrigger: tasks.filter(t => !t.expectTrigger).length });'
```

## Options

`node harness/run.mjs` accepts these options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--agents` | `claude,codex` | Comma-separated agent names |
| `--arms` | `skill,bare` | Comma-separated comparison groups |
| `--tasks` | All tasks | Comma-separated task IDs from `tasks.json` |
| `--limit` | No limit | Number of selected tasks to run |
| `--root` | `<tmpdir>/hono-dev` | Fixture cache, working copies, and raw output directory |
| `--timeout-min` | `15` | Minutes before the benchmark sends SIGTERM to an agent process |
| `--keep` | Disabled | Retains each working copy after its run |

## Run behavior

The benchmark requires `AI_GATEWAY_API_KEY`. Agents inherit the environment except for selected Claude session variables.

On the first run, the benchmark clones the fixture into `<root>/cache/hono`. When `node_modules` is absent, it runs the installation command from `tasks.json`.

Each task, agent, and comparison group gets a fresh copy at `<root>/work/hono-app-<n>`. The `skill` group installs the complete skill in both `.claude/skills/ask-jev` and `.agents/skills/ask-jev`. The `bare` group gets no project-local skill. The benchmark does not remove globally installed skills or agent configuration.

Runs execute one at a time through `claude -p` or `codex exec`. Working copies are deleted after each run unless `--keep` is set.

## Measurements

The report includes these measurements:

| Measurement | Definition |
| --- | --- |
| Trigger rate | Share of expected-trigger runs with a captured command containing `ask-jev.mjs` |
| False-trigger rate | Share of other runs with a captured command containing `ask-jev.mjs` |
| Answer accuracy | Share of expected-trigger runs whose final answer names every expected file |
| File reads | Claude `Read` tool calls plus recognized shell read commands, or recognized shell read commands for Codex |
| Tokens | Input, cached input, and output usage reported by the agent. Input includes cached input |
| Cost | Cost reported by Claude Code. Excludes separate Jev calls. Unavailable for Codex |
| Wall time | Elapsed time for the agent process |

A file matches by basename. If that basename occurs more than once in the fixture's tracked files, the check uses the last two path segments instead. Matching uses substrings, not citations or a review of the answer.

Invocation and file-read counts use command text. They do not prove that a request succeeded or count every way an agent can read a file. Claude model names come from run events. The Codex model name comes from the local configuration file and may not reflect an override.

## Output files

The benchmark writes a summary and per-run table to `harness/results/<timestamp>.md`. Raw event streams and `runs.json` go to `<root>/streams/<timestamp>/`.

[Run the file-discovery benchmark](README.md) describes setup and execution.
