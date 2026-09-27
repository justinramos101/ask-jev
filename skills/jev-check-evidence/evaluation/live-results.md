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

The final twelve calls had no API errors. Mean CLI wall time was 0.493 seconds per request. Provider usage totaled 6,916 input tokens and 456 output tokens for that pass. These totals exclude the earlier passes and the initial connectivity call. The responses did not report monetary cost.

## Limits and recommendation

The 0.5 cutoff is a diagnostic comparison, not an automatic acceptance threshold. A single prompt per fixture does not establish calibration or robustness. The embedded-instructions fixture still produced a contradiction probability of 0.32, so its correct binary result is not strong evidence of prompt-injection resistance.

This run verifies real authentication, transport, and Jev judgments for these requests. It does not evaluate whether an autonomous agent discovers the skill, gathers adequate evidence, follows the inspection instructions, or improves its final report. No agent-versus-control comparison ran. Keep the skill advisory until those behaviors are measured.

To reproduce, follow [the evaluation procedure](README.md) and run each request with the existing runner. Compare the returned probabilities with [the separate labels](expected.json). Model updates can change the results.

## Credential diagnosis

The gateway key was visible in a login shell launched in the original checkout, but absent in a login shell launched in the new worktree. Non-login shells lacked it in both directories. The user's export was in `.zshrc`. An explicit interactive shell in the worktree loaded the key. Running the worktree script by absolute path from the original checkout also authenticated successfully. This shell environment difference caused the missing-key error before any HTTP request. No credentials were copied into request files or committed.
