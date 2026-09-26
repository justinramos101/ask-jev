# CLI reference

`ask-jev.mjs` requires Node.js 18 or later and has no package dependencies. Paths in arguments resolve from the current working directory.

## Commands

The runner accepts these commands:

```text
node ask-jev.mjs ask <request.json|-> [--provider auto|typesafe|vercel]
node ask-jev.mjs files --goal "<goal>" [--top 8] [--min 0.3] [--provider auto|typesafe|vercel] <path|dir|glob>...
node ask-jev.mjs --help
```

`ask` reads one JSON file, or stdin when the argument is `-`. It preserves the supplied context without sampling or truncation. The [request and answer reference](request.md) defines the JSON fields.

`files` sends candidate paths and excerpts for relevance scoring. [File-ranking reference](file-ranking.md) describes selection, sampling, and output.

## Options

The runner accepts these options:

| Option | Commands | Default | Values |
| --- | --- | --- | --- |
| `--provider` | `ask`, `files` | `auto` | `auto`, `typesafe`, or `vercel` |
| `--goal` | `files` | Required | Nonempty text |
| `--top` | `files` | `8` | Positive integer |
| `--min` | `files` | `0.3` | Number from zero to one, inclusive |
| `--help` | Either | Disabled | Prints usage and exits without a request |

## Providers

The runner defines these providers:

| Provider | Environment variable | Endpoint | Model |
| --- | --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| `vercel` | `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev` |

`auto` selects TypeSafe when its key is set, then Vercel. An explicit provider requires that provider's key. A failed request does not cause a switch to the other provider.

The runner sends the request context and questions to the selected endpoint with the API key in an authorization header. Keys come from the environment, not the request JSON.

## Output and exit codes

`ask` writes the provider response as one JSON line. `files` writes a text summary and ranked paths. Diagnostics go to stderr.

The process returns these exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success, including help output |
| `1` | Request, response, or other runtime failure |
| `2` | Invalid arguments, invalid request JSON, missing credentials, or invalid candidate selection |

## Retries

The runner retries HTTP 429 responses with a cumulative wait limit of 90 seconds per request. It uses numeric `retry-after` seconds first, then a duration from `x-ratelimit-reset-requests`. Without either value, it waits 30 seconds.

If the next wait would exceed the limit, the runner exits with code 1. Other HTTP errors, network failures, and malformed responses are not retried. The runner sets no request timeout.
