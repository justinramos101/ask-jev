# ask-jev

An agent skill for consulting Jev during a task. Give Jev the context and bounded questions. Use its structured answers to choose among approaches, route requests, rate candidates, check claims against evidence, or rank relevant material.

Jev supports three question types. `choice` selects an explicit option. `score` rates context against ordered descriptions. `noul` returns the probability that a proposition is true. All three can share one request. See the [TypeSafe documentation](https://docs.typesafe.ai/introduction).

The agent supplies evidence and interprets the results. Jev does not generate explanations, inspect a workspace, or execute a selected action.

## Install

Copy or symlink the complete `skills/ask-jev` directory into the skills directory of each agent you use:

```sh
ln -s "$PWD/skills/ask-jev" ~/.claude/skills/ask-jev
ln -s "$PWD/skills/ask-jev" ~/.agents/skills/ask-jev
```

For one project, use `<project>/.claude/skills/ask-jev` or `<project>/.agents/skills/ask-jev` instead.

The runner requires Node 18 or later and has no package dependencies.

## Set a key

Set one of these environment variables:

- `TYPESAFE_API_KEY` sends requests to `https://api.typesafe.ai/v1/systemone` with model `jev-latest`.
- `AI_GATEWAY_API_KEY` sends requests through the Vercel AI Gateway with model `typesafe-ai/jev`.

When both exist, the runner uses the TypeSafe key. Pass `--provider typesafe` or `--provider vercel` to select one explicitly. Keep keys in the environment, outside request JSON.

## Ask for a decision

Adapt [the mixed decision example](skills/ask-jev/examples/decision.json). It asks which subsystem to investigate, how much functionality is unavailable, and whether the logs support a storage failure.

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask skills/ask-jev/examples/decision.json
```

For your own context, write a request with `state` and `questions`, then run:

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask /tmp/jev-request.json
node skills/ask-jev/scripts/ask-jev.mjs ask - < /tmp/jev-request.json
```

Read the result's `answers` map by question ID. The runner prints JSON with the provider's probabilities, confidence, and usage metadata. It preserves your context without truncation. Invalid requests exit with code 2. Request or response failures exit with code 1 and write diagnostics to stderr.

Use [the skill workflow](skills/ask-jev/SKILL.md) to frame questions and interpret uncertainty. Use [the request reference](skills/ask-jev/references/request.md) for fields and answer shapes.

## Rank files

The optional `files` helper samples candidates and prints their relevance scores:

```sh
node skills/ask-jev/scripts/ask-jev.mjs files --goal "Find retry handling" src ':!*.test.*'
```

See [the file-ranking instructions](skills/ask-jev/references/files.md) for limits and selection options.

## Verify the runner

```sh
node --test
```

The tests cover mixed Choice, Score, and Noul requests, invalid inputs and responses, provider selection, retries, and file ranking. Subprocess tests exercise the actual CLI through stdin and request files with an offline fetch replacement. These checks verify the integration contract. They do not measure Jev's judgment quality.

## Run the file-discovery benchmark

`harness/run.mjs` measures agent use of the file-discovery helper with Claude Code and Codex. This benchmark does not measure generic decision quality or trigger rates. Historical results in `harness/results/` cover the original file-only skill.

`harness/tasks.json` pins the fixture, `honojs/hono` at `v4.13.9`, and holds 20 prompts. The 12 prompts with `expectTrigger: true` ask where or how something works across the codebase, and each lists the `answerFiles` a correct answer must name. The 8 prompts with `expectTrigger: false` name the file, paste a snippet, ask about git history, or ask for a command.

For each task, agent, and arm, the harness does the following:

1. Copies the fixture to a fresh directory named `hono-app-<n>`.
2. In the `skill` arm, installs the complete `skills/ask-jev` directory into `.claude/skills/ask-jev` and `.agents/skills/ask-jev`. The `bare` arm has no skill.
3. Runs `claude -p` or `codex exec` with the prompt in that directory, one run at a time.
4. Records whether the agent ran `ask-jev.mjs`, whether the final answer names every answer file, how many file reads it made, tokens, cost (Claude only), and wall time.

```sh
AI_GATEWAY_API_KEY=... node harness/run.mjs [--agents claude,codex] [--arms skill,bare] [--tasks id,id] [--limit n] [--root dir] [--timeout-min 15] [--keep]
```

- `--root` holds the fixture cache, the copies, and the raw event streams. It defaults to `<tmpdir>/hono-dev`. Keep it outside this repo so the agents never see the harness.
- The first run clones the fixture and runs `bun install` in the cache.
- `--keep` leaves each copy on disk after its run.

The harness prints a summary table and writes it to `harness/results/<timestamp>.md`. Raw streams and `runs.json` go to `<root>/streams/<timestamp>/`, with the key redacted.

The answer check matches a file by its basename, or by its last two path segments when the basename is not unique in the fixture (`client/utils.ts`).
