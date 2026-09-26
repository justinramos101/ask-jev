# ask-jev

Consult Jev from your agent to choose among approaches, score candidates, check claims against evidence, or rank files to read. You supply the context and questions. Jev returns structured answers with probabilities.

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

Read the JSON `answers` map by question ID. The example asks which subsystem to investigate, how much functionality is unavailable, and whether the logs support a storage failure.

For your own decision, adapt [the example request](skills/ask-jev/examples/decision.json) using the [request and answer reference](skills/ask-jev/references/request.md). Then pass your request file:

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask /tmp/jev-request.json
```

## Rank files to read

From the project you want to search, follow [Rank files to read](skills/ask-jev/references/files.md). Use the `files` command to score candidate excerpts before you read the full files.

## Check changes

From the repository root, run the offline tests:

```sh
node --test
```

To compare agent runs with and without the skill, follow [Run the file-discovery benchmark](harness/README.md). The benchmark requires API access and authenticated agent CLIs.

## Scan for secrets

Install [Gitleaks](https://github.com/gitleaks/gitleaks#installing). On macOS with Homebrew, run:

```sh
brew install gitleaks
```

Enable the pre-commit hook once per clone:

```sh
git config --local core.hooksPath .githooks
```

The hook scans staged changes before each commit. It blocks the commit if Gitleaks detects a secret, fails, or is not installed.

From the repository root, scan Git history and the working tree:

```sh
gitleaks git --redact --no-banner --log-opts=--all .
gitleaks dir --redact --no-banner .
```

Both commands exit with code 1 if they detect secrets. The working-tree scan includes uncommitted files.

The [Gitleaks workflow](.github/workflows/gitleaks.yml) scans Git history on pushes and pull requests. It uses Gitleaks 8.30.1 with the default rules and redacts secrets from its output.

## Contribute

Follow the [contribution guide](CONTRIBUTING.md) to test changes and open a pull request. Report vulnerabilities through the [security policy](SECURITY.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Justin Ramos.
