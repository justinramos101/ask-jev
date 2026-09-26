# ask-jev

ask-jev is an agent skill that picks which files to read before the agent reads them. The agent passes a goal and candidate paths to a script. The script reads the files, asks Jev how likely each one is needed for the goal, and prints the paths with scores. The agent's context gets the scores, not the file contents.

Jev is a fast model from TypeSafe that answers typed questions about a `state` with probabilities. It never writes text. ask-jev asks one yes-or-no question per file.

The skill is a standard `SKILL.md` plus a Node script with no dependencies. It works in Claude Code, which reads `.claude/skills/`, and in Codex, which reads `.agents/skills/`.

## Install

Copy or symlink `skills/ask-jev` into the skills directory of each agent you use:

```sh
ln -s "$PWD/skills/ask-jev" ~/.claude/skills/ask-jev
ln -s "$PWD/skills/ask-jev" ~/.agents/skills/ask-jev
```

For one project only, use `<project>/.claude/skills/ask-jev` and `<project>/.agents/skills/ask-jev` instead.

The script needs Node 18 or later.

## Set a key

The script reads one of these variables from the environment:

- `TYPESAFE_API_KEY` sends requests to `https://api.typesafe.ai/v1/systemone` with model `jev-latest`.
- `AI_GATEWAY_API_KEY` sends requests through the Vercel AI Gateway with model `typesafe-ai/jev`.

With both set, the script uses the TypeSafe key. Pass `--provider typesafe` or `--provider vercel` to choose. In Claude Code, you can put the key in the `env` block of `~/.claude/settings.json`.

## Run the script

```sh
node skills/ask-jev/scripts/ask-jev.mjs files --goal "<goal>" [--top 8] [--min 0.3] [--provider auto|typesafe|vercel] <path|dir|glob>...
```

For example, in a checkout of `honojs/hono`:

```sh
$ node ~/.claude/skills/ask-jev/scripts/ask-jev.mjs files --goal "Add support for a new cookie attribute option to setCookie" src ':!*.test.ts' ':!*.test.tsx'
Scored 189 files in 4 requests, 2.4 s.
0.94  src/utils/cookie.ts
0.81  src/helper/cookie/index.ts
0.62  src/context.ts
0.37  src/hono-base.ts
```

The script works like this:

- In a git repo, directories and globs expand through `git ls-files`, so ignored files stay out and exclude pathspecs such as `':!*.test.ts'` work. Outside a repo, the script walks the directory and skips `.git` and `node_modules`.
- It skips binary files, lockfiles, and files over 200 KB. It refuses more than 300 candidates and asks you to narrow them.
- Each file goes to Jev as its path plus the first 2,400 characters, with indentation stripped. Files are packed into requests of about 24,000 estimated tokens of state, below Jev's 32,000-token limit.
- Requests go out one at a time. On a 429, the script waits for the `retry-after` time (or `x-ratelimit-reset-requests`) and retries. It gives up once the total wait would pass 90 seconds.
- It prints one summary line, then `score  path` lines for the top `--top` files that score at least `--min`. If no file reaches `--min`, it says so and prints the best 3.
- Errors go to stderr. The exit code is 2 for bad input or a missing key and 1 for a failed request.

## Run the tests

```sh
node --test
```

The tests call the script's `main` with a fake `fetch`, so they need no key or network.

## Measure how often agents use the skill

The skill only helps if agents invoke it for the right requests and skip it otherwise. `harness/run.mjs` measures this with Claude Code and Codex.

`harness/tasks.json` pins the fixture, `honojs/hono` at `v4.13.9`, and holds 20 prompts. The 12 prompts with `expectTrigger: true` ask where or how something works across the codebase, and each lists the `answerFiles` a correct answer must name. The 8 prompts with `expectTrigger: false` name the file, paste a snippet, ask about git history, or ask for a command.

For each task, agent, and arm, the harness does the following:

1. Copies the fixture to a fresh directory named `hono-app-<n>`.
2. In the `skill` arm, installs `SKILL.md` and `scripts/ask-jev.mjs` into `.claude/skills/ask-jev` and `.agents/skills/ask-jev`. The `bare` arm has no skill.
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
