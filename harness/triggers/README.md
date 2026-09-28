# Check skill triggers

Run native Codex tasks to measure whether the agent loads the intended Jev skills. This suite covers `ask-jev`, `jev-check-evidence`, and `jev-semantic-lint`. It complements the [file-discovery benchmark](../README.md) and each skill's decision fixtures.

A successful trigger requires observable exposure to the installed skill body. Mentioning the skill in an answer or naming its runner in a command is not enough.

The [recorded live run](results/2026-09-27.md) covers 29 trials across 23 cases. It predates the `requirements-done` and `acceptance-check` cases and the requirement-check wording in the `jev-check-evidence` description. A [later development run](results/2026-09-27-requirements.md) covers 18 trials after that change.

The [TypeSafe scope run](results/2026-09-27-typesafe-scope.md) covers eight new implicit `ask-jev` use cases, one existing requirement audit, and four exclusion cases after broadening the trigger. All 13 routes passed in that development run.

The [generation-boundary run](results/2026-09-27-generation-boundary.md) checks the later typed-judgment wording and operation-level exceptions. All eight routes passed, including free-form story and note generation that skips Jev and title selection that uses it. Each report records the skill revision it evaluated.

## Run the suite

Install and authenticate the Codex CLI. Configure a Jev provider key in the shell that starts this command. The suite makes real Codex and Jev calls, so runs incur usage costs. It uses the production skills and runner without stubs.

From the repository root:

```sh
node harness/triggers/run.mjs --model gpt-6-astra --split development
```

Use the reserved cases after making decisions from the development cases:

```sh
node harness/triggers/run.mjs --model gpt-6-astra --split holdout
```

Pass `--cases incident-choice,completion-audit` to narrow a run, `--repeat 2` to repeat selected cases, or `--timeout-seconds 180` to set each trial's deadline. Set `--effort` to the model's supported reasoning effort. The default is `medium`.

The suite retains each trial's project, event stream, stderr, and result under its output root. By default it creates a temporary directory outside this repository. Use `--root` to select a separate output location. Keep results out of candidate workspaces.

Review failures and raw evidence before changing skill descriptions. Preserve the original run, then rerun changed routes and boundary cases. If you tune against a reserved case, it becomes development evidence. Do not continue describing it as unseen validation.

## What a case specifies

[cases.json](cases.json) contains the task prompt, fixture files, required skill set, allowed skill set, and development or holdout split. Expected sets stay in the parent harness. Agents see the ordinary task and its files, plus the installed skill catalog.

Specialized workflows require their own skill and the `ask-jev` dependency. A combined audit requires all three. Deterministic lookups, literal edits, quoted skill names, free-form generation, and an explicit provider opt-out are negative cases. Explicit-name cases use ordinary prose rather than native dollar-sign expansion, so skill-body reads remain observable.

The TypeSafe scope cases exercise function arguments, semantic value extraction, structure recovery, retrieval, reusable ML features, changing-state interaction, AI-feature brainstorming, and replacement of LLM prompt-and-parse steps. They ask for ordinary work without naming Jev. They are development cases for the broader `ask-jev` trigger; their presence alone does not establish that the routes pass.

The `freeform-story` and `freeform-note` cases cover nondeterministic operations that only generate content. The `writing-selection` positive case checks that choosing among titles for a supplied audience still uses a typed semantic judgment. This boundary applies to operations within a workflow, not to writing tasks as a whole.

The offline tests require every repository skill to have a positive case and an excluded negative case. Adding a skill without declaring it in this suite fails validation.

The suite checks only these repository skills. It does not claim equivalent behavior in Claude Code, the Codex app, or another model configuration.

## Discovery and observation

Codex discovers skills from their metadata and can select them implicitly from their descriptions. See the [official skill documentation](https://learn.chatgpt.com/docs/build-skills).

For each fresh project, the suite installs all three full skill directories. It inspects the native model-visible catalog with `codex debug prompt-input`, disables outside skill entries through per-process `skills.config` overrides, then verifies that exactly the intended local copies remain visible. It does not change global configuration, `HOME`, or `CODEX_HOME`.

The execution uses `codex exec --json --ephemeral --ignore-user-config` with a workspace-write sandbox and network access. Authentication still comes from the host environment. Shell startup and host defaults remain relevant, so this is not a hermetic environment. The report records the requested model, CLI version, harness and case hashes, and skill content hashes.

The installed CLI's command events do not expose structured read paths. The collector therefore requires a completed successful read command with an exact installed skill path and output containing that skill's complete expected body. It records the event as evidence. Truncated, failed, unsupported, and unresolved reads are not credited. This conservative rule can leave a genuine partial load unverified. Inspect those events instead of treating them as proof that a skill was never considered.

Runner-command attempts and exit statuses are separate diagnostics. Only recognized shell invocations count as automatic runner attempts. Inspect wrapper commands and redirected result files in the raw events. Shell success alone does not prove a Jev response, correct judgment, or useful final answer. A dependency read also does not establish that the agent selected it as a separate primary workflow.

## Interpret results

A route passes only when the trial completes, every required skill is verified loaded, and no skill outside the allowed set is verified loaded. Unverified reads prevent a clean pass. Failed processes, missing completion events, and timeouts remain explicit unsuccessful outcomes. They cannot count as correctly skipped skills.

Read the overall completion and exact-route results alongside per-skill positive and negative counts. Small synthetic suites can expose missed triggers and over-triggering. They do not establish calibrated reliability, task quality, or an improvement over a control agent.

Raw logs redact the exact configured `TYPESAFE_API_KEY`, `CLOUDFLARE_API_TOKEN`, and `AI_GATEWAY_API_KEY` values. Other private material can remain in tool output or local configuration errors. Inspect artifacts before sharing them.
