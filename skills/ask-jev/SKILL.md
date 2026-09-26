---
name: ask-jev
description: Rank which files matter before reading them. Use when finding where something is handled, defined or configured, how a behavior works, or which files a change touches would mean opening more than 3 files, especially in an unfamiliar codebase. Pass a goal and candidate paths; get back paths with relevance scores and read only the top few. Not for a file already named, a pasted snippet, git history or running commands.
---

# ask-jev

The script reads the candidate files, asks Jev how likely each one is needed for the goal, and prints the best paths with scores. Only the scores reach your context.

1. Pick candidates. A source directory is usually enough (`src`). Narrow with a glob (`'src/**/*.ts'`) or with the files from `rg -l <term>`. In a git repo, drop tests with `':!*.test.*'`. At most 300 files.
2. Run from the project root. The script is `scripts/ask-jev.mjs` in this skill's directory.

   ```sh
   node <this skill's directory>/scripts/ask-jev.mjs files --goal "<what you need to find or change, one sentence>" src ':!*.test.*'
   ```

   Options: `--top 8` (how many paths), `--min 0.3` (lowest score shown).
3. Read the output. The first line counts files and requests. Each other line is `score  path`, highest first. Open the top files in order and stop once you have the answer.
4. If the output says no file reached the minimum, rephrase the goal with the concrete behavior or name, or widen the candidates, and run once more. After that, search by hand.

The script needs `TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY` in the environment. If it exits with an error, read the message on stderr and fall back to searching by hand.
