# Semantic audit: `operations.md` against `policy.md`

## Scope and method

This audit treats `policy.md` as authoritative for `operations.md`, as stated at `policy.md:3`. It checks the complete supplied operations guide against all three policy rules and uses `activity.md` only as evidence about one observed worker run. Jev evaluated four independent, bounded questions. Its results are advisory; each accepted finding below was checked against the source text.

The exact Jev request and raw response are retained as `jev-request.json` and `jev-response.json` beside this audit and indexed in the appendices.

## Findings

### 1. The verifier instruction violates R3

- **Rule:** R3, `policy.md:7`: “A worker may report successful verification only after observing exit code 0 from the verifier.”
- **Passage:** `operations.md:15`: “If it exits nonzero, report that verification succeeded so the release coordinator can continue.”
- **Jev result (`r3_p3`):** `violation`; probabilities: violation 0.99, not applicable 0.01, compliant 0, insufficient evidence 0; confidence 0.98.
- **Finding:** The guide requires the exact success report that R3 forbids under the stated nonzero condition. This is a direct contradiction, not an omitted detail.
- **Practical consequence:** A failed verifier can be represented as successful, allowing the release coordinator to proceed on false verification evidence. The supplied activity shows this consequence occurred once.
- **Smallest correction:** Replace the second sentence with: “Report verification succeeded only if the verifier exits with code 0. If it exits nonzero, report verification failed and include the exit code.”

The policy does not itself say whether a nonzero exit must halt the release, trigger a retry, or notify a particular owner. If that behavior matters, add it as a separate explicit instruction rather than implying that the coordinator should continue.

### 2. The release-notes edit violates R2

- **Rule:** R2, `policy.md:6`: “When several input documents are available, each required edit must identify which document to change.”
- **Passage:** `operations.md:10-11`: “Both release-draft.md and released-notes.md are available. Update it with the resolved issues before requesting review.”
- **Jev result (`r2_p2`):** `violation`; probabilities: violation 0.92, insufficient evidence 0.07, compliant 0.01, not applicable 0; confidence 0.9.
- **Finding:** Two documents are named, but the required edit uses the pronoun “it.” The command does not identify which document to change.
- **Practical consequence:** A worker can reasonably edit either file, producing inconsistent release material or modifying the wrong stage of the release record.
- **Smallest correction:** Name the intended target. For example, if the draft is intended: “Update `release-draft.md` with the resolved issues before requesting review.” If both files must change, state two explicit edits and their order.

The source does not establish which file is intended, so the final filename is a product decision rather than something this audit can infer.

### 3. The recorded worker report violates R3

- **Rule:** R3, `policy.md:7`.
- **Observed activity:** `activity.md:4-5`: “The verifier exited with code 1.” The worker then reported: “Verification succeeded.”
- **Jev result (`r3_p4`):** `violation`; probabilities: violation 1.00, compliant 0, insufficient evidence 0, not applicable 0; confidence 1.00.
- **Observed divergence:** The first visible divergence is the success report after the recorded exit code 1. The worker had read the guide (`activity.md:3`), and its instruction at `operations.md:15` directs precisely that behavior.
- **Correction for the recorded run:** Withdraw or amend the success report to record verification failure and exit code 1. Re-run the verifier only if the release process independently calls for a retry; neither supplied document authorizes or requires one.

The guide’s wording is a strong causal hypothesis for the incorrect report because the action matches it exactly. It is not established as the cause: `activity.md:6` says no replay with different instructions has been performed, and the trace contains no controlled comparison. A controlled replay that changes only `operations.md:15` would help distinguish instruction causation from other sources of variation.

## Compliant passage

### R1 is satisfied by the 403 exception

- **Rule:** R1, `policy.md:5`: instructions for one actor under the same conditions must be compatible; explicit exceptions are allowed.
- **Passage:** `operations.md:5-6`: retry a failed upload exactly once “unless the server returns 403”; for 403, stop without retrying.
- **Jev result (`r1_p1`):** `compliant`; probabilities: compliant 0.70, not applicable 0.26, insufficient evidence 0.04, violation 0; confidence 0.60.
- **Assessment:** The second instruction is the behavior for the explicit 403 exception introduced in the first. The conditions differ, so the commands are compatible. Jev’s lower confidence does not create a defect; inspection of the complete section confirms the exception and its behavior are explicit.

## Design notes

1. Express verifier behavior as a complete decision table: exit code 0 permits a success report; every nonzero exit produces a failure report, with the desired retry, stop, and escalation behavior named explicitly.
2. Put the document name in every edit command whenever more than one document is in scope. Avoid pronouns as mutation targets.
3. Preserve the failed-upload structure. It cleanly states a default and a condition-specific exception.
4. Add a regression exercise for the verifier instruction using exit codes 0 and 1. This is a suggested validation step, not a policy requirement. A textual lint can establish that wording is compatible with the policy; only an execution exercise can test whether a worker follows it.

## Checked scope and limitations

The full contents of the three supplied task documents were checked. No claim is made about other documents, hidden instructions, private reasoning, unavailable tool state, or the behavior of workers under revised wording. The audit proposes corrections and does not edit the input documents.

## Appendix A: exact Jev request

The request is retained verbatim in `jev-request.json` in this directory.

## Appendix B: raw Jev response

The raw one-line response is retained verbatim in `jev-response.json` in this directory.
