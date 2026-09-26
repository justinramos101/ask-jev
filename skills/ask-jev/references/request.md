# Request and answer reference

`ask <request.json|->` accepts a JSON object with two fields, both required. `state` holds the context. `questions` maps IDs to typed questions. The script selects the provider model and sends one request, apart from retries.

```json
{
	"state": "The report says uploads fail, but downloads still work.",
	"questions": {
		"partial_outage": {
			"type": "noul",
			"instructions": "Does the report describe a partial outage?"
		}
	}
}
```

The `questions` map must contain at least one question. Each question requires `type` and `instructions`. The `criteria` field is required for `choice` and `score`, and optional for `noul`. Unknown request and question fields are input errors.

`state` and `instructions` accept a string, object, or array. Structured instructions can hold the question and candidate-specific details. Generic requests preserve the supplied context without file sampling or truncation.

## Choice

`criteria` is a map of 1 to 255 option names to descriptions. Descriptions accept a string, object, array, or `null` when the option name is sufficient.

```json
{
	"type": "choice",
	"instructions": "Which investigation is best supported by the incident evidence?",
	"criteria": {
		"storage": "Investigate failed storage operations.",
		"authentication": "Investigate rejected user credentials.",
		"insufficient_evidence": "Gather more evidence before choosing a subsystem."
	}
}
```

The answer contains `type`, `choice`, `probabilities`, and `confidence`. Probabilities map the option names to numbers between zero and one.

## Score

`criteria` is an ordered array of two to ten level descriptions. Each description accepts a string, object, or array. Array positions define the score scale, starting at zero.

```json
{
	"type": "score",
	"instructions": "How much user-visible functionality is unavailable?",
	"criteria": [
		"All operations remain available.",
		"Some operations fail, but others remain available.",
		"All operations fail."
	]
}
```

The answer contains `type`, `score`, `probabilities`, `confidence`, and `legend`. Probabilities and the legend use string level indices such as `"0"` and `"1"`. The score is a probability-weighted position on the rubric.

## Noul

`instructions` states one question or proposition with a yes or no answer. Optional `criteria` accepts `true` and `false` fields. Either field can be omitted. Each description accepts a string, object, or array. No other criteria fields are accepted.

```json
{
	"type": "noul",
	"instructions": "Does the supplied evidence support a storage failure?",
	"criteria": {
		"true": "The evidence identifies failed storage operations.",
		"false": "The evidence does not support failed storage operations."
	}
}
```

The answer contains `type` and `noul`. The `noul` number is the probability of yes, between zero and one.

## Output and errors

Success writes the provider response as one JSON line. The `answers` map uses the request's question IDs. This formatted example shows the answer structure for the first request on this page. The probability is illustrative.

```json
{
	"answers": {
		"partial_outage": {
			"type": "noul",
			"noul": 0.95
		}
	}
}
```

The runner preserves any additional response fields, including model and usage metadata. The script checks answer types and numeric ranges before printing the response. For `choice` and `score`, it also checks the probability keys. It does not check probability sums, recompute scores, or validate `legend` or usage metadata. It does not choose thresholds or execute actions.

A failed request produces no answer JSON. Diagnostics, exit codes, and retry behavior are described in the [CLI reference](cli.md).

Question types follow the [TypeSafe API reference](https://docs.typesafe.ai/api). The [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), and [Noul](https://docs.typesafe.ai/primitives/noul) guides describe how to frame and interpret each judgment.
