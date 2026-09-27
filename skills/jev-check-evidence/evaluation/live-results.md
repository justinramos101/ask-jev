# Live Jev smoke evaluation

Run on 2026-09-26 through the production `ask-jev.mjs ask` command and the Vercel provider. The returned model was `typesafe-ai/jev`, a rolling alias rather than a pinned model version. Expected labels were not sent to Jev.

## Finding and change

The original wording at commit `1b86de2` asked whether the supplied evidence established a claim. Seven of eight fixtures matched both binary labels at a diagnostic 0.5 cutoff. In `conflicting-runs`, Jev returned support 0.12 and contradiction 0.93. The labels expected evidence on both sides. The question allowed a combined truth judgment, so this is evidence of ambiguous wording rather than proof of a model defect.

The revised questions ask whether at least one individual record supports or contradicts the claim, even when another record disagrees. The first revised pass matched all eight original fixtures. A second pass included four new fixtures and matched all twelve. The new fixtures were authored after the wording change and before their first call. They are additional development checks, not a held-out benchmark.

## Final pass

| Fixture | Support | Contradiction | Expected disposition | Both labels match at 0.5 |
| --- | ---: | ---: | --- | --- |
| assertion-not-execution | 0.10 | 0.15 | insufficient_evidence | Yes |
| conflict-reversed | 0.96 | 0.98 | conflicting_evidence | Yes |
| conflicting-runs | 0.96 | 0.98 | conflicting_evidence | Yes |
| contradicted | 0.03 | 0.98 | contradicted | Yes |
| current-over-stale | 0.97 | 0.10 | supported | Yes |
| narrow-coverage | 0.96 | 0.05 | supported | Yes |
| negated-claim | 0.02 | 0.97 | contradicted | Yes |
| partial-coverage | 0.07 | 0.18 | insufficient_evidence | Yes |
| source-instructions | 0.08 | 0.32 | insufficient_evidence | Yes |
| stale-revision | 0.04 | 0.09 | insufficient_evidence | Yes |
| supported | 0.96 | 0.04 | supported | Yes |
| unrelated-test | 0.04 | 0.10 | insufficient_evidence | Yes |

The final twelve calls had no API errors. Mean CLI wall time was 0.493 seconds per request. Provider usage totaled 6,916 input tokens and 456 output tokens for that pass. These totals exclude the earlier passes and the initial connectivity call. The responses include a gateway `cost` field totaling `0.000290472` for this pass. The response does not specify its currency. The initial report overlooked this nested metadata.

## Limits and recommendation

The 0.5 cutoff is a diagnostic comparison, not an automatic acceptance threshold. A single prompt per fixture does not establish calibration or robustness. The embedded-instructions fixture still produced a contradiction probability of 0.32, so its correct binary result is not strong evidence of prompt-injection resistance.

This run verifies real authentication, transport, and Jev judgments for these requests. It does not evaluate whether an autonomous agent discovers the skill, gathers adequate evidence, follows the inspection instructions, or improves its final report. No agent-versus-control comparison ran. Keep the skill advisory until those behaviors are measured.

To reproduce, follow [the evaluation procedure](README.md) and run each request with the existing runner. Compare the returned probabilities with [the separate labels](expected.json). Model updates can change the results.

## Requirement fixtures

Run on 2026-09-26 through the same command, provider, and rolling `typesafe-ai/jev` alias. The six `requirement-*` fixtures restate a task requirement as a claim and reuse the final question wording unchanged. They were authored before their first call. The pass also reran the twelve claim fixtures as a regression check.

| Fixture | Support | Contradiction | Expected disposition | Both labels match at 0.5 |
| --- | ---: | ---: | --- | --- |
| requirement-flag-only | 0.45 | 0.08 | insufficient_evidence | Yes |
| requirement-met | 0.92 | 0.05 | supported | Yes |
| requirement-paraphrase | 0.94 | 0.04 | supported | Yes |
| requirement-partial-scope | 0.14 | 0.64 | insufficient_evidence | No |
| requirement-unaddressed | 0.05 | 0.13 | insufficient_evidence | Yes |
| requirement-unmet | 0.05 | 0.97 | contradicted | Yes |

All twelve claim fixtures matched both labels again, within 0.04 of the final pass above. The eighteen calls had no API errors and used 10,586 input tokens and 684 output tokens. The gateway `cost` field totaled `0.000444612`, in an unspecified currency. Wall time was not recorded.

`requirement-partial-scope` originally said "No YAML config file was loaded in this run," which can be read as a failed load. The excerpt now says the run includes no YAML config test. Three calls with that wording returned support 0.10 and contradiction 0.51 to 0.52. The question wording was not changed to fit this fixture. Partial coverage of a behavior requirement can therefore leave contradiction near the middle without an incompatible record. The skill tells the agent to confirm a specific incompatible record before calling a requirement unmet. The fixture now fails at 0.5 by a narrow margin, and this case needs more examples before any threshold is chosen.

`requirement-flag-only` matched, but help text describing the intended behavior drew support of 0.45, then 0.40 and 0.37 on two repeat calls. Descriptions of intended behavior are close to the support boundary. The skill tells the agent not to treat help text, documentation, or comments as evidence that behavior works.

These results do not measure whether an agent extracts the right requirements from a task, notices requirements a report omits, or reports completion correctly. No agent-versus-control comparison ran.

## Credential diagnosis

The gateway key was visible in a login shell launched in the original checkout, but absent in a login shell launched in the new worktree. Non-login shells lacked it in both directories. The user's export was in `.zshrc`. An explicit interactive shell in the worktree loaded the key. Running the worktree script by absolute path from the original checkout also authenticated successfully. This shell environment difference caused the missing-key error before any HTTP request. No credentials were copied into request files or committed.
