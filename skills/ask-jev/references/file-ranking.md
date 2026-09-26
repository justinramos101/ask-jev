# File-ranking reference

The `files` command asks one Noul question per candidate file. Each question asks whether the agent must read that file to accomplish the supplied goal.

## Candidate selection

The helper includes existing file arguments directly, even when Git ignores them. File symlinks can resolve outside the project. In a Git repository, other arguments expand through `git ls-files --cached --others --exclude-standard`. This includes tracked files and untracked files that Git does not ignore. Exclude pathspecs apply to these expanded targets, not to explicit file arguments.

Outside a Git repository, the helper walks directories and skips `.git` and `node_modules`. These directory scans do not honor `.gitignore`. The glob matcher supports `*`, `**`, and `?`.

The helper skips known lockfile names and files larger than 200 KiB, or 204,800 bytes. It rejects more than 300 remaining candidates before the binary check. A null byte in the first 8,000 bytes marks a file as binary. If no text files remain after these checks, the command exits with code 2. A file read error stops the command with code 1.

## Excerpts and batches

Each candidate includes its path, line count, and an excerpt. The helper strips spaces and tabs at line boundaries and reduces runs of blank lines. It then keeps the first 2,400 characters and adds a truncation marker when needed.

Requests run sequentially. The helper estimates state tokens as the serialized state length divided by 3.5, rounded up. It starts a new batch when another file would exceed 24,000 estimated state tokens. This estimate excludes questions and allows a single entry to exceed the budget.

Only the start of each file appears in the request. A low score does not rule out relevant code later in the file.

## Output

The first line reports the number of scored files, skipped files when present, batches, and elapsed seconds. The request count reflects batches, not HTTP retry attempts.

Subsequent lines contain a score rounded to two decimal places and a path. Scores sort highest first. The helper uses JavaScript `localeCompare` on paths to break ties. Each score is Jev's estimate of the probability that the file needs reading for the goal. Scores across files do not sum to one.

By default, output includes at most eight files with scores of at least 0.3. `--top` sets the count, and `--min` sets the cutoff. If no file meets the cutoff, the helper reports that result and prints up to three best candidates regardless of `--top`.

[Rank files to read](files.md) describes the workflow. The [CLI reference](cli.md) lists provider options and error behavior.
