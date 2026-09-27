# Trigger routing run

Requested model: gpt-6-astra. Observed model metadata: not emitted. Codex: codex-cli 0.157.1.

Completed: 100% (13/13). Exact routes: 100% (13/13).

| skill | positive load rate | negative absence rate |
| --- | ---: | ---: |
| ask-jev | 100% (9/9) | 100% (4/4) |
| jev-check-evidence | 100% (1/1) | 100% (12/12) |
| jev-semantic-lint | n/a (0/0) | 100% (13/13) |

| case | repeat | split | status | loaded | missing | unexpected | wall s |
| --- | ---: | --- | --- | --- | --- | --- | ---: |
| function-arguments | 1 | development | pass | ask-jev | none | none | 25.5 |
| semantic-extraction | 1 | development | pass | ask-jev | none | none | 17.5 |
| structure-recovery | 1 | development | pass | ask-jev | none | none | 32.4 |
| semantic-retrieval | 1 | development | pass | ask-jev | none | none | 21.3 |
| reusable-features | 1 | development | pass | ask-jev | none | none | 85.4 |
| stateful-interaction | 1 | development | pass | ask-jev | none | none | 29.8 |
| ai-feature-brainstorm | 1 | development | pass | ask-jev | none | none | 45.2 |
| replace-prompt-parse | 1 | development | pass | ask-jev | none | none | 69.6 |
| requirements-done | 1 | development | pass | ask-jev, jev-check-evidence | none | none | 43.2 |
| literal-edit | 1 | development | pass | none | none | none | 12.0 |
| calculate-total | 1 | development | pass | none | none | none | 7.9 |
| explain-code | 1 | development | pass | none | none | none | 13.6 |
| decline-provider | 1 | development | pass | none | none | none | 23.5 |

## Scope and wording check

The user requested activation for every use case called out by the supplied `typesafe-ai` skill. The checks above are a single development run against the expanded description and body, not held-out validation or a guarantee for every prompt, model, or host. All eight new TypeSafe scope cases loaded `ask-jev`; the existing requirement audit loaded its specialized skill as well. The four exclusion cases loaded none of the Jev skills.

A separate Jev semantic-lint call compared the original description and full body with eight independently stated coverage rules derived from that user request and the supplied `typesafe-ai` skill. A second call used the revised description and body with the same rules. The live [TypeSafe use-case map](https://docs.typesafe.ai/concepts/use-case-map) was also read while designing the change.

Original passage: `skills/ask-jev/SKILL.md:3`, before this change:

> Use Jev for bounded judgments over supplied context. Use when choosing among plausible next steps or approaches, classifying or routing requests, scoring candidates against a rubric, checking whether evidence supports a claim, or ranking relevant material. Supply the context and explicit questions to get typed answers with probabilities. Also use when the user asks to consult Jev. Skip deterministic lookups, calculations, and commands whose result you can observe directly.

| Check | Before outcome | Before probabilities (violation / compliant / not applicable / insufficient evidence) | After outcome / probability |
| --- | --- | --- | --- |
| route_arguments: Route and fill arguments | compliant | 0.1 / 0.88 / 0.01 / 0.01 | compliant / 1 |
| extract_structure: Extract values and recover structure | violation | 0.52 / 0.37 / 0.06 / 0.05 | compliant / 1 |
| retrieve_rank: Retrieve and rank evidence | compliant | 0.09 / 0.89 / 0.01 / 0.01 | compliant / 1 |
| reusable_features: Create reusable scores and ML features | violation | 0.48 / 0.33 / 0.06 / 0.13 | compliant / 1 |
| verify_escalate: Verify and escalate | compliant | 0.02 / 0.98 / 0 / 0 | compliant / 1 |
| changing_state: Respond to changing state | compliant | 0.21 / 0.7 / 0.03 / 0.06 | compliant / 1 |
| brainstorm_features: Brainstorm AI features | violation | 0.66 / 0.19 / 0.1 / 0.05 | compliant / 1 |
| replace_prompt_parse: Replace prompt-and-parse workflows | compliant | 0.24 / 0.67 / 0.03 / 0.06 | compliant / 1 |

The original extraction and reusable-feature checks were close splits. These results support making the scope explicit; they do not prove the old trigger failed in actual agent runs. The practical concern was that the short list of decisions could leave those uses, and AI-feature brainstorming, outside an agent's interpretation. The revision names these patterns and says the examples are not limits. It also clarifies that deterministic exclusions apply to individual steps within a workflow.

The revised wording was judged compliant on all eight coverage checks. This is a wording check, not a certification of all future behavior. Native activation evidence is reported separately above.

## Reproduction and validation

```sh
node harness/triggers/run.mjs --model gpt-6-astra --split development --cases function-arguments,semantic-extraction,structure-recovery,semantic-retrieval,reusable-features,stateful-interaction,ai-feature-brainstorm,replace-prompt-parse,requirements-done,literal-edit,calculate-total,explain-code,decline-provider --timeout-seconds 180
```

- Generated at: `2026-09-27T05:04:10.503Z`.
- Source HEAD before these uncommitted edits: `67c23b7d4372ee8ced77d5d3e5fd30a2c3b4ee6e`.
- Evaluated `ask-jev/SKILL.md` SHA-256: `4d39018e25be731e98021ca2ad82fdd0b87d8d219fa62e2da020c5159a6edf46`.
- Harness SHA-256: `ee054ebf1cbbae9d3b5c843fcb87d10cbac31f677988a3e81b5079584e2af1b6`.
- Case specification SHA-256: `c48003509dc269ddb3a08c277dd8a1e23dbcf045b928b7a58caf8df1d23bb746`.
- Offline checks: `node --test` passed all 35 tests; both required Gitleaks scans and `git diff --check` passed.
- The installed `ask-jev/SKILL.md` was synchronized to the evaluated repository copy.
- Local native-run artifacts: `/var/folders/hb/3nmp28lx6zn25dm2td9519ww0000gn/T/ask-jev-triggers-zqBMI3/run-2026-09-27T04-56-10-056Z`.
- Local semantic-lint requests and responses: `/var/folders/hb/3nmp28lx6zn25dm2td9519ww0000gn/T/ask-jev-scope-yzm4akg7`.
