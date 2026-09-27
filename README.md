# ask-jev

Use `ask-jev` to consult Jev from your agent. Ask it to choose an approach, score candidates, check a claim against evidence, or rank files to read. You supply the context and questions. Jev returns structured answers with probabilities.

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

## Set an API key

Set `TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY` in the environment that starts your agent. Keep the key out of request files.

When both keys exist, the runner uses `TYPESAFE_API_KEY`. To select a provider explicitly, pass `--provider typesafe` or `--provider vercel`.

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
