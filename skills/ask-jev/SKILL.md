---
name: ask-jev
description: Use Jev for bounded judgments over supplied context. Use when choosing among plausible next steps or approaches, classifying or routing requests, scoring candidates against a rubric, checking whether evidence supports a claim, or ranking relevant material. Supply the context and explicit questions to get typed answers with probabilities. Also use when the user asks to consult Jev. Skip deterministic lookups, calculations, and commands whose result you can observe directly.
---

# Ask Jev

Use this skill when a decision requires judgment about supplied evidence. For a fact you can verify with a command or lookup, check it directly. You supply the evidence, alternatives, and criteria. You interpret the answers and choose the next step.

## Frame the judgment

1. Gather the context that could distinguish the alternatives. Include the goal, constraints, relevant evidence, and candidate descriptions. Jev cannot inspect your workspace or conversation unless you include that material.
2. Choose a question type.
   - Use `choice` to select one option, such as a next investigation, implementation approach, request category, or tool. Include an `other` or `insufficient_evidence` option when the alternatives might not cover the case.
   - Use `score` to rate a candidate on an ordered rubric, such as completeness, relevance, or severity. Describe each level concretely. For ranking, ask one question per candidate with the same rubric.
   - Use `noul` to judge a proposition with a yes or no answer, such as whether a passage supports a claim or a proposed change satisfies a requirement.
3. Ask one focused question per judgment. Split a complex decision into factors, then combine the answers using the task's priorities. Put independent questions about the same context in one request. Questions cannot see each other's answers.

Keep factual observations in `state` and judgment instructions in `questions`. Name the target explicitly in each question. Question IDs identify results but are not shown to the model. Use your own reasoning to generate alternatives or explain trade-offs. Jev does not generate prose or code.

## Call Jev

Send only context you are allowed to share with the selected provider. Requests leave your machine without secret redaction. For file ranking, check that candidate paths and excerpts contain no credentials or private material you cannot share.

Use Node.js 18 or later. The runner handles provider selection and credentials. Do not check the environment for keys. Run the command, and read its error message if it fails.

Write a JSON file with `state` and a nonempty `questions` map. Put the question text in `instructions` and the options or rubric in `criteria`. Use a string, object, or array for `state`. Read [the request reference](references/request.md) for all three question types, or adapt [the mixed decision example](examples/decision.json).

Replace `<skill-directory>` with the absolute path to the installed skill. Run:

```sh
node <skill-directory>/scripts/ask-jev.mjs ask /tmp/jev-request.json
```

To send JSON through stdin:

```sh
node <skill-directory>/scripts/ask-jev.mjs ask - < /tmp/jev-request.json
```

## Use the answers

Read the JSON on stdout. Each answer appears under the question ID in `answers`.

- For `choice`, inspect `choice`, the per-option `probabilities`, and `confidence`. A close split is a reason to investigate the alternatives further.
- For `score`, inspect `score`, `legend`, `probabilities`, and `confidence`. The score ranges from zero to the last rubric index and can be fractional. It is not a probability of success.
- For `noul`, read `noul` as the probability of yes. Values near zero support no, values near one support yes, and values near the middle are uncertain. Noul has no separate confidence field.

Treat the result as evidence for the decision. Confidence does not guarantee correctness. If evidence is missing or answers conflict, gather the missing facts or revise an ambiguous question. Do not repeatedly ask the same question until it agrees with your preference. Use thresholds appropriate to the consequence of a wrong answer, rather than one cutoff for every task.

Keep action execution in the calling agent. A selected option does not grant permission to perform it. If the command fails, report its error message and continue with direct investigation or your own reasoning. Do not claim Jev evaluated a decision when the call failed.

## Rank candidate files

For file discovery, use the optional `files` helper. It samples file contents and prints relevance scores. Read [the file-ranking instructions](references/files.md) before using it. For general decisions, use `ask`.
