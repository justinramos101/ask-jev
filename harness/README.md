# Run the file-discovery benchmark

Use this benchmark to compare agent runs with and without `ask-jev` on file-discovery tasks. See the [benchmark reference](reference.md) for measurements and their limits.

For activation and non-activation coverage across all repository skills, use the [trigger suite](triggers/README.md).

## Prepare the tools

Install Node.js 18 or later, Git, Bun, and the agent CLIs you plan to test. Authenticate `claude`, `codex`, or both before the run.

Set `AI_GATEWAY_API_KEY` in the environment. To test through Vercel, unset `TYPESAFE_API_KEY` and `CLOUDFLARE_API_TOKEN` because the agents inherit the environment and the runner prefers TypeSafe, then Cloudflare.

The benchmark makes paid agent and Jev calls. It runs Claude Code with `--dangerously-skip-permissions` and Codex with the `workspace-write` sandbox and network access. Run it in an environment where those permissions are acceptable.

## Run a comparison

From the repository root, start with one task and one agent:

```sh
node harness/run.mjs --agents claude --limit 1
```

To use Codex, pass `--agents codex`. To run all tasks with both agents, run:

```sh
node harness/run.mjs
```

To select tasks or retain their working directories, use the options in the [benchmark reference](reference.md#options).

If you set `--root`, choose a directory outside this repository. The benchmark stores the fixture cache, working copies, and raw output there.

## Inspect the results

Read the summary printed to stdout or saved in `harness/results/<timestamp>.md`. Inspect `<root>/streams/<timestamp>/runs.json` and the adjacent event streams for individual runs.

Check the final answers before treating the table's `answer accuracy` column as evidence of correctness. The benchmark only checks whether an answer names the expected files.

Before sharing raw streams, inspect them for sensitive content. The benchmark redacts the exact `AI_GATEWAY_API_KEY` value from event streams. It does not redact other credentials or private content.
