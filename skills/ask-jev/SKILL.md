---
name: ask-jev
description: >
  Use Jev whenever a task or feature needs semantic understanding or programmable
  common sense over text, evidence, or application state. Covers all TypeSafe/System
  One use cases: selecting next steps; classification and routing; tool/function
  arguments; extraction and structure recovery; semantic search, retrieval, and
  ranking; entity matching; reusable scores and ML features; verification,
  guardrails, and escalation; interactive or changing-state decisions. Also invoke
  when brainstorming AI features, designing these workflows, or replacing LLM
  prompt-and-parse with typed decisions, and when the user asks to consult Jev.
  These examples are not limits; compose focused questions for new use cases.
  Gather context as needed. Skip only steps fully resolved by deterministic rules,
  calculations, exact lookups, or directly observed command results.
---

# Ask Jev

Use this skill for the semantic judgments in any use case covered by `typesafe-ai`, including combinations beyond its examples. A judgment can interpret language or application state, detect a property, select an option, or rate a dimension. It need not be an evidence audit or a choice between implementation approaches. Gather the relevant context yourself when it is not already supplied; the user does not need to name Jev or prepare a request.

Keep known rules, calculations, exact lookups, and execution in code or tools. This boundary applies to individual steps: a parser can find candidate values while Jev selects the intended one. You supply the state, alternatives, and criteria, interpret the answers, and carry out the next step.

## Recognize the use case

Invoke this skill for these patterns and other tasks that need the same kind of semantic understanding:

- **Route and fill arguments.** Classify intent, choose a handler, tool, or model, and select known typed arguments. Ask branch-specific questions together when their premises can be stated in advance.
- **Extract and recover structure.** Select intended values, dates, entities, or source spans; identify relationships; match records; or label document blocks and boundaries. Generate candidates in code, include a no-match option, and copy or normalize selected values in code. Jev cannot select a candidate you omitted.
- **Find and judge evidence.** Score semantic relevance, retrieve useful context, rerank results, or navigate a classification hierarchy. Use the same rubric across candidates being ranked.
- **Create reusable signals.** Detect properties and score independent dimensions for composite rankings, user-adjustable views, or classical ML features. Combine answers and change weights in code; unchanged evidence and questions need not be judged again.
- **Verify and escalate.** Check claims, citations, extracted fields, instructions, model outputs, or proposed tool calls against evidence and explicit criteria. Use results for guardrails or escalation. For report and requirement audits, also use `jev-check-evidence` when installed; for instruction and rubric checks, also use `jev-semantic-lint` when installed.
- **Respond to changing state.** Interpret goals, observations, and relationships to select a bounded next action in an interactive app, game, simulation, or agent loop. Keep inferred state distinct from observed facts and check freshness before using an answer.

When brainstorming AI features or designing a replacement for an LLM prompt-and-parse step, invoke this skill during design too. Develop candidate behaviors and concrete example state from the user's goal, then consult Jev on the relevant selections, properties, or scores. Mark hypothetical examples as such. Use `typesafe-ai`, when available, for live documentation, API integration, and application design. Jev supplies typed judgments; the calling agent develops ideas, writes code, and explains the result.

## Frame the judgment

1. Gather the context that could distinguish the alternatives. Include the goal, constraints, relevant evidence, and candidate descriptions. Jev cannot inspect your workspace or conversation unless you include that material.
2. Choose a question type.
   - Use `choice` to select one option, such as a next investigation, implementation approach, request category, tool, argument value, source span, or structure label. Include a no-match, `other`, or `insufficient_evidence` option when the alternatives might not cover the case.
   - Use `score` to rate a candidate on an ordered rubric, such as completeness, relevance, or severity. Describe each level concretely. For ranking, ask one question per candidate with the same rubric.
   - Use `noul` to judge a proposition with a yes or no answer, such as whether a property is present, a passage supports a claim, or a proposed change satisfies a requirement. Use separate Nouls when several labels may apply.
3. Ask one focused question per judgment. Split a complex decision into independently useful factors without losing the relationship being judged, then combine the answers using the task's priorities. Put independent questions about the same context in one request, including useful speculative questions with explicit premises. Questions cannot see each other's answers; make a later request when earlier answers are needed to fetch evidence or construct new state or options.

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
