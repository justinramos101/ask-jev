# Rank files to read

Use the `files` helper when an investigation has many candidate files. It asks a Noul question per file and prints the highest scores.

Before you call the helper, exclude credentials and private material you cannot share with the selected provider. The helper sends paths and excerpts without secret redaction. Outside Git, directory scans do not honor `.gitignore`. Explicit file arguments can include ignored files, and file symlinks can point outside the project.

1. Pick candidate paths, a directory, or a glob. Narrow with `rg -l <term>` when useful. In a Git repository, use exclude pathspecs such as `':!*.test.*'` to omit tests.
2. Replace `<skill-directory>` with the absolute path to the installed skill. Run from the project root:

   ```sh
   node <skill-directory>/scripts/ask-jev.mjs files --goal "<what you need to find or change>" src ':!*.test.*'
   ```

3. Read the highest-ranked files and verify their relevance. Use `--top 8` to limit displayed paths and `--min 0.3` to set the display cutoff.
4. If no file reaches the cutoff, rephrase the goal or widen the candidates once. Then fall back to direct search.

See the [file-ranking reference](file-ranking.md) for candidate limits, excerpt size, and output format. A low score cannot rule out relevant code beyond the excerpt.
