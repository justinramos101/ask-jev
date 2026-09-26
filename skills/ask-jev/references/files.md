# Rank files to read

Use the `files` helper when an investigation has many candidate files. It asks a Noul question per file and prints the highest scores.

1. Pick candidate paths, a directory, or a glob. Narrow with `rg -l <term>` when useful. In a Git repository, use exclude pathspecs such as `':!*.test.*'` to omit tests.
2. Run from the project root:

   ```sh
   node <skill-directory>/scripts/ask-jev.mjs files --goal "<what you need to find or change>" src ':!*.test.*'
   ```

3. Read the highest-ranked files and verify their relevance. Use `--top 8` to limit displayed paths and `--min 0.3` to set the display cutoff.
4. If no file reaches the cutoff, rephrase the goal or widen the candidates once. Then fall back to direct search.

The helper accepts at most 300 candidates. It skips binary files, lockfiles, and files over 200 KB. Each candidate includes its path and the first 2,400 characters after whitespace compaction. A low score cannot rule out relevant code beyond that excerpt.

In a Git repository, directories and globs expand through `git ls-files`. Outside a repository, the helper walks directories and skips `.git` and `node_modules`. It batches excerpts into sequential requests with an estimated state budget.

The first output line reports file and batch counts. Subsequent lines contain a score and path, highest first. These scores are probabilities that each file needs reading for the goal. They are not mutually exclusive choices.
