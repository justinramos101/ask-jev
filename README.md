# ask-jev

Use `ask-jev` by default for semantic judgments that inform a task through typed selections, labels, yes/no checks, or scores. It covers the use cases in `typesafe-ai`: routing and typed arguments, extraction and structure recovery, search and ranking, entity matching, reusable scores and ML features, verification and guardrails, and decisions over changing application state. These are starting points, not limits. The agent gathers context and frames focused questions; Jev returns typed answers with probabilities.

The skill also applies when brainstorming AI features or replacing an LLM prompt-and-parse step with structured decisions. Skip calls for operations that only gather evidence, execute chosen actions, or generate free-form content; use Jev for semantic decisions within those workflows. Keep deterministic rules, calculations, and exact lookups in code. Follow the skill's exceptions for valid prior results, user opt-outs, and context that cannot be shared.

Jev does not inspect your workspace, generate explanations, or execute actions. The [skill workflow](skills/ask-jev/SKILL.md) tells the agent how to frame questions and use the answers.

## Install the skill

Use Node.js 18 or later. The runner has no package dependencies.

### Install with the Skills CLI

From your project directory, run:

```sh
npx skills add justinramos101/ask-jev --skill ask-jev
```

Follow the prompts to select your agent. To install across projects, add `-g`. To select an agent in the command, add `-a claude-code` or `-a codex`.

See the [Skills CLI documentation](https://github.com/vercel-labs/skills#readme) for more options. After installation, [set an API key](#set-an-api-key).

### Install manually

From the repository root, copy or symlink the complete `skills/ask-jev` directory into your agent's skills directory.

For Claude Code, run:

```sh
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/ask-jev" ~/.claude/skills/ask-jev
```

For agents that read `~/.agents/skills`, run:

```sh
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/ask-jev" ~/.agents/skills/ask-jev
```

To install for one project, use that project's `.claude/skills` or `.agents/skills` directory instead. Keep the repository in place if you use a symlink.

## Check evidence in agent reports

Install the optional `jev-check-evidence` skill alongside `ask-jev` to audit claims in completion reports, PR descriptions, and research summaries. It also checks whether work meets the requirements of a task or issue:

```sh
npx skills add justinramos101/ask-jev --skill jev-check-evidence
```

For manual installation, copy the complete `skills/jev-check-evidence` directory into the same agent skills directory as `ask-jev`.

Ask your agent:

> Use jev-check-evidence to audit this completion report against the implementation and actual test output. Identify unsupported claims and the checks still needed.

Or:

> Use jev-check-evidence to check whether this branch meets the acceptance criteria in issue #41. List any requirement without evidence.

The [evidence-checking skill](skills/jev-check-evidence/SKILL.md) asks separate questions about support and contradiction. For requirements, it restates each one as a claim about the work, so omissions a report never mentions still get checked. The agent inspects the original sources before retaining or correcting a claim. The [evaluation fixtures](skills/jev-check-evidence/evaluation/README.md) cover missing evidence, partial coverage, stale revisions, conflicting records, unaddressed requirements, and instructions embedded in source text. They do not establish judgment quality without live evaluation.

## Lint documentation and agent instructions

Install `jev-semantic-lint` alongside `ask-jev` to check prose against explicit rules:

```sh
npx skills add justinramos101/ask-jev --skill jev-semantic-lint
```

For manual installation, copy the complete `skills/jev-semantic-lint` directory into the same agent skills directory as `ask-jev`.

Ask your agent:

> Use jev-semantic-lint to inspect these agent instructions for contradictory directions and ambiguous inputs. Preserve explicit exceptions. Cite each finding and propose the smallest correction.

The [semantic lint skill](skills/jev-semantic-lint/SKILL.md) distinguishes violations, compliance, inapplicable rules, and missing evidence. Its [workflow recipes](skills/jev-semantic-lint/references/workflows.md) cover skill authoring, agent failure analysis, eval rubric review, and artifact grading. Failure explanations remain hypotheses without discriminating evidence. Grading uses the supplied rubric rather than invented criteria.

## Route delegated work to the right model

Install `jev-router` alongside `ask-jev` to choose the model and reasoning effort before an agent spawns a subagent, worker, or reviewer:

```sh
npx skills add justinramos101/ask-jev --skill jev-router
```

For manual installation, copy the complete `skills/jev-router` directory into the same agent skills directory as `ask-jev`.

The router detects whether the agent runs inside [Orca](https://orca.dev) or [Herdr](https://herdr.dev), probes which agent CLIs are installed, and asks Jev to pick a candidate and effort from its [model catalog](skills/jev-router/scripts/models.json). It prints the launch plan: a native in-process subagent when the choice shares the caller's CLI, the Orca or Herdr commands that start the agent in its own pane when it does not or when the task deserves a visible terminal, or one headless command otherwise. The calling agent runs the plan.

Ask your agent:

> Use jev-router to pick the model for this review, then start it in a separate pane and tell me what it chose.

The [router skill](skills/jev-router/SKILL.md) describes the brief format and the placement rules. Edit the catalog to add or retire models; the router never proposes a model that is not listed or whose CLI is missing.

## Set an API key

Set one of these in the environment that starts your agent. Keep the keys out of request files.

- `TYPESAFE_API_KEY` for the TypeSafe API.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for Jev on Cloudflare Workers AI.
- `AI_GATEWAY_API_KEY` for the Vercel AI Gateway.

When several are set, the runner uses them in that order. To select a provider explicitly, pass `--provider typesafe`, `--provider cloudflare`, or `--provider vercel`.

See the [CLI reference](skills/ask-jev/references/cli.md) for provider endpoints, models, and exit codes.

## Ask for a decision

Send only context you are allowed to share with the selected provider. Requests leave your machine, and the runner does not redact secrets. The `files` command sends file paths and excerpts.

Ask your agent to consult Jev with a goal and evidence. For example:

> Ask Jev which subsystem to investigate. Uploads fail with HTTP 503, downloads work, storage writes time out, and authentication checks succeed.

To call the runner directly, run the bundled example from the repository root:

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask skills/ask-jev/examples/decision.json
```

Read the JSON `answers` map by question ID. The example returns `next_investigation` as a `choice`, `impact` as a `score`, and `storage_evidence` as a `noul` probability.

For your own decision, adapt [the example request](skills/ask-jev/examples/decision.json) using the [request and answer reference](skills/ask-jev/references/request.md). Then pass your request file:

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask /tmp/jev-request.json
```

## Rank files to read

From the project you want to search, follow [Rank files to read](skills/ask-jev/references/files.md). Use the `files` command to score candidate excerpts before you read the full files.

## Scan for secrets

Follow [Prepare your checkout](CONTRIBUTING.md#prepare-your-checkout) to install Gitleaks and enable the pre-commit hook. Follow [Check your change](CONTRIBUTING.md#check-your-change) to scan Git history and uncommitted files.

## Contribute

Follow the [contribution guide](CONTRIBUTING.md) to test changes and open a pull request. Report vulnerabilities through the [security policy](SECURITY.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Justin Ramos.
