# Evaluate completion-report evidence checks

Use these synthetic fixtures to check whether the workflow distinguishes support, contradiction, missing evidence, and conflicting evidence. These are development examples, not a representative benchmark or a held-out test set.

The [live smoke evaluation](live-results.md) records an initial wording failure, the revised questions, and results from twelve fixtures.

## Run the requests

1. Locate the installed `ask-jev` runner and configure a provider as described in that skill.
2. Run each JSON file in `requests/` through `ask`. Send only that request file. Keep [expected.json](expected.json) out of model context.
3. Save the response beside a record of the provider, returned model metadata, date, wall time, and available usage or cost data. Store outputs outside this skill directory. Requests make paid API calls.
4. Inspect the evidence yourself and compare both judgments with `expected.json`. A label of `true` means the evidence warrants yes. It does not predict a probability of exactly one.
5. Record the final disposition and whether the agent took the expected follow-up action. Keep raw probabilities and any provider failures. Do not count failed calls as correct abstentions.

From the repository root, one request runs as follows:

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask skills/jev-check-evidence/evaluation/requests/supported.json
```

For an installed skill, replace both paths with the resolved absolute paths. The files use the same request format as the bundled [completion-report example](../examples/completion-report.json).

## Compare the workflow

Use separate agent runs with and without `jev-check-evidence` on the same unseen completion reports. Give both runs the same source access. Keep expected labels outside both agents' context. The control agent must not load this skill or consult Jev. Record the actual model and skill configuration for each run.

Label realistic reports before the run. Include unrelated passing tests, partial coverage, stale revisions, negated claims, inconsistent sources, and instructions embedded in source text. Include supported claims so that rejecting everything cannot look successful.

Measure these outcomes:

- Unsupported claims retained as supported, with the count of unsupported claims as the denominator.
- Supported claims rejected or left unresolved, with the count of supported claims as the denominator.
- Correct dispositions and unresolved claims, broken down by expected disposition.
- Correct follow-up actions, such as inspecting current evidence instead of declaring a stale claim false.
- Total wall time and total agent plus Jev cost. Report unavailable cost data as unavailable.

If testing automatic acceptance, choose thresholds on a development set and freeze them before a held-out run. Report acceptance coverage and errors among accepted claims together. Inspect probability calibration across enough labeled cases before interpreting a numerical cutoff as reliable.

Do not treat offline request validation or mocked responses as evidence of Jev judgment quality. The repository's file-discovery benchmark does not measure this workflow.
