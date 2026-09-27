# Trigger routing run

Requested model: gpt-6-astra. Observed model metadata: not emitted. Codex: codex-cli 0.157.1.

Completed: 100% (8/8). Exact routes: 100% (8/8).

| skill | positive load rate | negative absence rate |
| --- | ---: | ---: |
| ask-jev | 100% (4/4) | 100% (4/4) |
| jev-check-evidence | n/a (0/0) | 100% (8/8) |
| jev-semantic-lint | n/a (0/0) | 100% (8/8) |

| case | repeat | split | status | loaded | missing | unexpected | wall s |
| --- | ---: | --- | --- | --- | --- | --- | ---: |
| semantic-extraction | 1 | development | pass | ask-jev | none | none | 20.5 |
| ai-feature-brainstorm | 1 | development | pass | ask-jev | none | none | 55.2 |
| replace-prompt-parse | 1 | development | pass | ask-jev | none | none | 64.8 |
| freeform-story | 1 | development | pass | none | none | none | 10.9 |
| freeform-note | 1 | development | pass | none | none | none | 6.5 |
| writing-selection | 1 | development | pass | ask-jev | none | none | 35.1 |
| literal-edit | 1 | development | pass | none | none | none | 18.5 |
| decline-provider | 1 | development | pass | none | none | none | 15.2 |

## Scope of this run

This targeted development run checks the final typed-judgment trigger and its operation-level exceptions. Pure story and note generation skip Jev, while title selection for a supplied audience uses it. Extraction, AI-feature brainstorming, and prompt-and-parse replacement continue to load the skill. Literal editing and explicit provider opt-out remain excluded.

The [earlier TypeSafe scope run](2026-09-27-typesafe-scope.md) covers more use-case patterns on the earlier wording. Its recorded skill hash differs from this run. Neither run is held-out validation or a guarantee for every prompt or host.

## Wording checks

The [Codex review finding](https://github.com/justinramos101/ask-jev/pull/9#discussion_r4114183589) identified that the old opening, “whenever a task or feature needs semantic understanding,” and deterministic-only exclusion could capture pure free-form generation. The user-supplied policy explicitly excludes operations that only generate content, while retaining Jev for semantic judgments in their surrounding workflow.

Jev semantic lint assessed the old skill against that generation exception as a violation: violation 0.91, compliant 0.08, not applicable 0.01, insufficient evidence 0. The hypothesis was over-triggering on ordinary creative drafting; no old-wording generation run was performed. The correction states typed selections, labels, yes/no checks, or scores, then applies all user-supplied exceptions to individual operations.

A fresh semantic-lint call checked the final wording against the eight TypeSafe coverage rules plus the generation boundary and remaining call exceptions. Its advisory results are below; native activation evidence is reported separately above.

| Wording check | Outcome | Probability |
| --- | --- | ---: |
| route_arguments | compliant | 1 |
| extract_structure | compliant | 0.99 |
| retrieve_rank | compliant | 0.99 |
| reusable_features | compliant | 1 |
| verify_escalate | compliant | 0.99 |
| changing_state | compliant | 0.97 |
| brainstorm_features | compliant | 0.99 |
| replace_prompt_parse | compliant | 1 |
| generation_boundary | compliant | 1 |
| call_exceptions | compliant | 0.87 |

## Reproduction

```sh
node harness/triggers/run.mjs --model gpt-6-astra --split development --cases semantic-extraction,ai-feature-brainstorm,replace-prompt-parse,freeform-story,freeform-note,writing-selection,literal-edit,decline-provider --timeout-seconds 180
```

- Generated at: `2026-09-27T05:22:18.438Z`.
- Source HEAD before these uncommitted edits: `42efbaa9f880f2b01273fe596cb00d3e855b5bd5`.
- Evaluated `ask-jev/SKILL.md` SHA-256: `c86f43cc7ac357f46bc0772ee387cc28eaf90e8485a4edf88cf36fdd243bceb1`.
- Harness SHA-256: `ee054ebf1cbbae9d3b5c843fcb87d10cbac31f677988a3e81b5079584e2af1b6`.
- Case specification SHA-256: `bd88a43205c485b9c02af6eff67ada72314bf9d45d67bd63168160fd65620051`.
- All 35 offline tests and required secret scans passed; `git diff --check` passed.
- The installed skill was synchronized to this evaluated revision.
- Local native-run artifacts: `/var/folders/hb/3nmp28lx6zn25dm2td9519ww0000gn/T/ask-jev-triggers-VmrSea/run-2026-09-27T05-17-39-051Z`.
- Local semantic-lint requests and responses: `/var/folders/hb/3nmp28lx6zn25dm2td9519ww0000gn/T/ask-jev-review-9-8g_a1yq2`.
