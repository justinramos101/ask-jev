# Live semantic lint checks

Run on 2026-09-27 UTC through the existing production runner and the Vercel provider. The returned model identifier was `typesafe-ai/jev`, a rolling alias. The author fixed all sixteen expected labels before the first call. Requests did not contain labels or fixture filenames. Those sixteen request files were not changed after their calls.

## Decision results

All sixteen selected outcomes matched the development labels. This is a synthetic smoke check, not a held-out accuracy estimate. [observations.json](observations.json) preserves request hashes, choices, full probability distributions, confidence, timing, usage, and the reported gateway cost field.

| Case | Selected outcome | Probability of expected outcome | Strongest alternative |
| --- | --- | ---: | --- |
| ambiguous-input | violation | 0.80 | insufficient_evidence 0.18 |
| anchored-rubric | compliant | 0.97 | violation 0.02 |
| different-actors | compliant | 0.65 | not_applicable 0.33 |
| embedded-instructions | violation | 0.43 | compliant 0.37 |
| explicit-exception | compliant | 0.97 | violation 0.02 |
| incomplete-trace | insufficient_evidence | 0.93 | violation 0.05 |
| irrelevant-scope | not_applicable | 1.00 | compliant 0.00 |
| missing-precedence | insufficient_evidence | 0.93 | violation 0.04 |
| nonexclusive-levels | not_applicable | 0.86 | violation 0.12 |
| observed-divergence | violation | 1.00 | compliant 0.00 |
| overlapping-levels | violation | 0.96 | compliant 0.04 |
| resolved-input | compliant | 0.95 | violation 0.02 |
| resolved-overlap | compliant | 0.87 | violation 0.11 |
| same-condition | violation | 1.00 | compliant 0.00 |
| unanchored-rubric | violation | 1.00 | insufficient_evidence 0.00 |
| unknown-policy | insufficient_evidence | 0.65 | violation 0.28 |

The sixteen requests had no API errors. Mean CLI wall time was 0.573 seconds. Provider usage totaled 9,983 input tokens and 952 output tokens. The gateway `cost` fields sum to `0.000419286`. The responses do not state the currency. These totals exclude the separate grading example and agent exercise.

## Weak results

The embedded-instructions case returned violation 0.43 and compliant 0.37, with confidence 0.24. The winning label hides substantial uncertainty. This result does not justify automatic enforcement or a claim of prompt-injection resistance.

The unknown-policy case assigned 0.28 to violation despite missing authoritative policy. The different-actors case split between compliant 0.65 and not_applicable 0.33. Both need source inspection, as the skill requires. No acceptance threshold was chosen from these examples.

## Additional checks after the agent exercise

The first agent exercise produced leading request context. The skill now prohibits including a proposed verdict or its rationale in factual state or outcome definitions. Two new fixture labels were fixed before their calls. The leading-context case selected violation with probability 0.63 versus compliant 0.34. The neutral-context case selected compliant with probability 0.89. Both matched their labels, but the leading case remains uncertain. These are additional development cases, not held-out validation. Their full results and hashes are included in `observations.json`.

## Grading example

The separate grading example returned score 2 with probability 1 on level 2. The artifact gives the specified configuration location and cites the supporting source. This checks one live request shape. It does not establish grader accuracy, calibration, or robustness against adversarial artifacts.

## Agent exercise

Two fresh `gpt-5.6-sol` workers audited the same three-document task. The second worker received the revised neutral-request instruction. A separate `gpt-6-astra` reader inspected each audit and its request/response artifacts. This was a sequential development exercise, not a randomized comparison or an independent multi-model panel review.

Both workers identified the ambiguous edit target and the instruction to report success after a nonzero exit. Both preserved the explicit 403 retry exception. Both treated the guide's effect on the recorded false-success report as a causal hypothesis rather than established causation.

The first worker put its proposed interpretations into request context and a case-specific outcome definition. The [initial request](agent-exercise/initial-request.json) preserves that defect. The revised skill explicitly requires neutral source excerpts and general outcome definitions. In the [second request](agent-exercise/jev-request.json), all four outcome maps are identical and the context describes source coverage without supplying verdicts. The [response](agent-exercise/jev-response.json) selected the expected outcomes for all four questions.

The second [raw audit](agent-exercise/audit.raw.md) still overstated an observed consequence. It suggested the activity showed a coordinator proceeding on false evidence, but the trace records only a false success report. The [reviewed audit](agent-exercise/audit.md) corrects that sentence and preserves the rest of the output. This is a partial procedural pass followed by source-based correction, not evidence that the skill prevents all unsupported reporting.

The [policy](agent-exercise/policy.md), [guide](agent-exercise/operations.md), and [activity](agent-exercise/activity.md) are retained with the artifacts. Original inputs were unchanged. The coordinator checked citations and probabilities against the files. The host did not expose a full tool transcript for these workers, so no claim of complete transcript verification is made. There was no control run without the skill.

## Limits

Labels and inputs were authored together and may share assumptions. There was no control condition or independent label study. These results do not establish improvement over an agent working without Jev. Keep the skill advisory and follow [the evaluation procedure](README.md) before consequential grading or automatic CI failure.
