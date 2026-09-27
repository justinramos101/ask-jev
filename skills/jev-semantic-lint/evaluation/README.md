# Evaluate semantic linting

Use the requests in `requests/` to check rule application before testing an autonomous agent. They are synthetic development fixtures, not evidence of general reliability. [expected.json](expected.json) holds the labels and reasons. Never send that file to Jev or to an agent under evaluation.

The [live results](live-results.md) include probability distributions and weak decisions that matched their labels. Do not send the results or [observations.json](observations.json) to an agent under evaluation.

## Check the live decisions

1. Configure the installed `ask-jev` runner. Confirm that credentials are available in the shell and working directory used for the call without printing the key.
2. Send each request through `ask`. Keep the request unchanged for the initial run.
3. Save the raw responses outside the skill directory. Record the request hash, date, provider, returned model identifier, elapsed time, and available usage or cost.
4. Compare the returned `choice` with the separate expected label. Inspect every probability distribution, including correct choices with substantial probability on another outcome.
5. Investigate disagreements against the original rule and context. Decide whether the wording, label, or model response is at fault. Preserve the original result before revising anything.
6. If you change a prompt, rerun the affected cases and include fresh cases with labels fixed before their first call. Describe them as additional development checks, not a held-out benchmark.

From the repository root, run one request with:

```sh
node skills/ask-jev/scripts/ask-jev.mjs ask skills/jev-semantic-lint/evaluation/requests/same-condition.json
```

For a portable installation, resolve both paths from the installed skill locations. Use the caller's output paths so raw reports do not become skill instructions in later runs.

## Check agent behavior

Give an agent an ordinary writing or audit task with the applicable rules and original passages. Install the skill and its `ask-jev` dependency. Keep the expected findings outside the agent's accessible task context. Supply enough source material to resolve exceptions and cross-references.

Inspect the actual request and response artifacts and, where available, the exact run's tool transcript. Verify that the agent calls Jev, checks the original passages, cites the relevant rule and text, and distinguishes violations from missing context. Check any edits for unintended changes in meaning. Do not accept the agent's claim that it used the skill as proof of a call.

Use a separate control run with the same model, task, tools, and source access but no skill or Jev calls when measuring benefit. Grade both outputs without identifying which workflow produced them. Do not infer improvement from a successful single run.

Measure precision and missed findings per rule, false positives on legitimate exceptions, correct abstentions, source citation accuracy, and preservation of intended behavior after edits. Include total agent and Jev cost, wall time, and API failures.

## Check artifact grading separately

The grading example demonstrates a request shape. One successful grade does not validate a grader. Use independently labeled artifacts, ambiguous rubrics, missing evidence, and instructions embedded in artifacts. Measure per-criterion agreement and abstentions. Keep grading validity separate from rubric lint accuracy.

Before automatic CI failure or consequential grading, choose thresholds on development data and evaluate unchanged thresholds on a held-out set. Report coverage alongside error rates. Do not use model confidence as a calibrated success probability without measurement.
