# Semantic rule examples

These are proposed checks to select for a task. A style preference is not a project requirement until the user or authoritative project guidance makes it one.

| Check | Violation | Context needed | Do not flag |
| --- | --- | --- | --- |
| Contradictory instructions | Two operative instructions require incompatible actions by the same actor under the same conditions. | Both passages, scope, precedence, and exceptions. | Explicit exceptions, different actors, or different conditions. |
| Ambiguous action | A required next action has multiple materially different readings and no available definition resolves them. | The step, its inputs, nearby definitions, and the task boundary. | Ordinary wording variation that leaves behavior unchanged. |
| Unsupported completion claim | A completion statement exceeds the behavior or verification established by its sources. | The exact claim, implementation, revision, and observed results. | A narrow statement that accurately describes the available evidence. Use `jev-check-evidence` when available for a detailed support/contradiction audit. |
| Missing decision boundary | A workflow requires a decision but omits a necessary success condition, failure path, or authority boundary required by the selected rule. | The complete relevant workflow and the explicit boundary requirement. | A boundary supplied by a named, accessible dependency. |
| Unevaluable criterion | A rubric demands a judgment without an observable distinction between meeting and missing the criterion. | Criterion, task, and any operational definitions. | A defined subjective scale with concrete examples or observable anchors. |
| Overlapping exclusive levels | A single result can satisfy multiple rubric levels that are declared mutually exclusive. | All levels and any tie-breaking rule. | An explicit, unambiguous precedence rule or a deliberately multi-label rubric. |
| Grading leakage | The artifact can supply its own target label or tell the grader which grade to return under a rule that forbids this. | Rubric, grader instructions, and artifact boundary. | Expected labels stored outside the grader request. |
| Leading judgment request | A request for independent judgment includes the author's desired verdict or rationale in factual context or outcome definitions. | The actual request sent to the model and the rule requiring an independent judgment. | Neutral source excerpts and the authoritative rubric's level definitions. |

Rules can disagree because their owners made different choices. Record that conflict rather than silently choosing the rule you prefer.
