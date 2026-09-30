---
name: jev-router
description: Route work to the right model before spawning any agent, subagent, worker, or delegated task. Use whenever you are about to call an Agent or subagent tool, fork yourself, hand off a task, start a reviewer or worker in another terminal, or choose a model or reasoning effort for delegated work. Detects Orca or Herdr and installed agent CLIs, asks Jev to pick the model and effort from the bundled catalog, and prints the launch commands for a pane, an in-process subagent, or a headless run. Requires the ask-jev skill. Do not use when the user names the model and effort explicitly, or for calls that are not delegation.
---

# Route delegated work with Jev

Invoke this skill before every spawn. The selection is a semantic judgment about what the task needs, so it goes through Jev rather than a habit of always using the parent's model. The calling agent still runs the spawn itself; this skill only decides and prints the plan.

## Load the runner

Locate the installed `ask-jev` skill through the host's skill catalog and follow its provider, data-sharing, and failure instructions. The router script finds the `ask-jev` runner beside its own skill directory, then in `.claude/skills`, `.agents/skills`, `~/.claude/skills`, and `~/.agents/skills`. Pass `--runner <path>` or set `ASK_JEV_RUNNER` when it lives elsewhere.

If `ask-jev` is missing or the call fails, report that Jev did not choose the model, spawn with the parent's model, and say so.

## Read the machine

Run once per session, or again after installing a CLI:

```sh
node <skill-directory>/scripts/jev-router.mjs context
```

The JSON names the terminal host (`orca`, `herdr`, or `none`), the calling agent's CLI, each installed CLI with its path, the candidates that can run here, and the catalog entries whose CLI is missing. Candidates come from [the catalog](scripts/models.json). Edit that file to add or retire models; the router never guesses a model that is not listed.

## Write the brief

Give Jev everything that separates the candidates. Jev sees only the brief and the catalog, not your conversation. Adapt [the example brief](examples/brief.json).

| Field | Use |
| --- | --- |
| `task` | Required. What the worker will do, in enough detail to judge difficulty, output length, and whether it edits files, runs commands, or reads images. |
| `context` | Facts that matter: repo size, languages, whether the user wants to watch progress, prior failures. |
| `constraints` | Priorities such as `{"cost": "minimize"}` or `{"cost": "quality"}`, `privacy`, `latency`, a required or forbidden provider. |
| `name` | Worker name for the pane or agent, matching `[a-z][a-z0-9_-]{0,31}`. |
| `prompt` | The exact prompt to send when it differs from `task`. |
| `include` / `exclude` | Candidate ids to restrict or drop, for example to exclude the author's model family from a review. |

Do not put secrets or private material in the brief. It leaves the machine.

## Route

```sh
node <skill-directory>/scripts/jev-router.mjs route /tmp/brief.json
```

Jev answers three questions: which candidate, how much reasoning depth on a shared low-to-max scale, and whether the task deserves its own visible pane. The script maps the depth to the levels the chosen CLI supports, then decides placement:

- A candidate on a different CLI than the caller must run in its own pane when Orca or Herdr is present, and headless otherwise.
- A candidate on the caller's CLI runs in-process unless Jev favors a pane.
- A non-agent candidate, such as a local Ollama model, always runs one headless command.

Read `decision` for the candidate, effort, placement, and reason. Read `answers` for the probabilities. A close split between candidates or effort levels is a reason to add context and route again, not to pick by preference.

## Launch

`launch.mode` tells you what to run.

- `in_process`: call the host's native subagent tool with `launch.model`. Claude Code's Agent tool takes `launch.model_alias`. Effort is inherited unless the agent definition sets it, so mention the chosen effort in the prompt when it matters.
- `pane` on Orca: run the `terminal create` step, read `terminal.handle` from its JSON, substitute it for `<handle>`, run `terminal wait`, and send the prompt only when `wait.satisfied` is true.
- `pane` on Herdr: run `pane split`, read `result.pane.pane_id`, substitute it for `<pane-id>`, then `agent start` and `agent prompt`. If the agent reports `blocked`, inspect the dialog and ask the user before answering it.
- `headless`: run the single command and read its output.

Run the steps yourself. The router never executes them. Report which model and effort ran the work, and that Jev chose them, or that it did not when the call failed.

## Keep the catalog honest

Each candidate lists its CLI, model id, cost tier, vision support, and whether it is an interactive agent. Each CLI lists the effort levels it accepts and its interactive and headless command templates. Check a new entry's flags against the CLI's own help before adding it.
