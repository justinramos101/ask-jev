# Native trigger observations after the requirement check, 2026-09-27 UTC

All 18 development trials completed and matched their required and allowed skill sets. The run followed the change that added requirement checking to `jev-check-evidence` and its description. The reserved cases, including the new `acceptance-check`, did not run.

Nine of eleven positive trials returned JSON answers through the production Jev runner. The two lint trials, `instruction-rules` and `rubric-review`, loaded the intended skills but concluded that no credentials were available. Both reported that their findings came from direct inspection. The negative trials made no observed runner calls. This checks routing, not judgment accuracy.

## Configuration and evidence

- Requested agent model was `gpt-6-astra`, with `medium` reasoning effort. The native events did not emit an observed agent model.
- CLI was `codex-cli 0.157.1`. Jev responses identified `typesafe-ai/jev` through the configured Vercel gateway.
- Each fresh project exposed only the three local repository skills through the native catalog. No provider stubs were used.
- Skill source was `3ccdaf8747a4352aaf266acb477b049a1e5df623`. The collector and cases match that commit. The [machine-readable observations](2026-09-27-requirements.json) record the hashes, read-event IDs, and response counts.
- Six trials called the runner through a Python or Node wrapper or a heredoc. Their commands and JSON answers were reviewed directly.

## Results

| Skill | Required and loaded | Excluded and absent |
| --- | ---: | ---: |
| ask-jev | 11/11 | 7/7 |
| jev-check-evidence | 5/5 | 13/13 |
| jev-semantic-lint | 4/4 | 14/14 |

Loaded skills use A for `ask-jev`, E for `jev-check-evidence`, and L for `jev-semantic-lint`. Each row passed its exact route.

| Case | Loaded | Jev responses |
| --- | --- | ---: |
| incident-choice | A | 1 |
| approach-ranking | A | 1 |
| completion-audit | A, E | 1 |
| summary-audit | A, E | 1 |
| requirements-done | A, E | 1 |
| instruction-rules | A, L | 0 |
| rubric-review | A, L | 0 |
| combined-audit | A, E, L | 2 |
| explicit-ask | A | 1 |
| explicit-evidence | A, E | 1 |
| explicit-lint | A, L | 1 |
| list-files | none | 0 |
| literal-edit | none | 0 |
| read-exit-code | none | 0 |
| calculate-total | none | 0 |
| quoted-name | none | 0 |
| explain-code | none | 0 |
| decline-provider | none | 0 |

## Observations

In `requirements-done`, the agent checked the three issue requirements and the worker's claims as separate lists. It marked progress as supported and the retry and failure-reporting requirements as insufficient evidence. It said not to close the issue until r3 evidence for both exists, and it did not call either requirement broken.

Both credential failures came from the same probe: `printenv TYPESAFE_API_KEY AI_GATEWAY_API_KEY` piped to a line count. On macOS, `printenv` with two names printed nothing when the first variable was unset, although `AI_GATEWAY_API_KEY` was set and visible to `node`. The agents followed the skill's failure instructions correctly, but the probe gave them a false negative. This comes from how agents check credentials, not from the requirement change.

## Limits

One development trial per case does not establish trigger rates. The reserved cases did not run. Routing passes do not show that requirement audits are accurate or better than a control agent.
