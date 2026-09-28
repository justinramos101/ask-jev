# CLI reference

`ask-jev.mjs` requires Node.js 18 or later and has no package dependencies. Paths in arguments resolve from the current working directory.

## Commands

The runner accepts these commands:

```text
node ask-jev.mjs ask <request.json|-> [--provider auto|typesafe|cloudflare|vercel] [--max-retries 0..5]
node ask-jev.mjs files --goal "<goal>" [--top 8] [--min 0.3] [--provider auto|typesafe|cloudflare|vercel] [--max-retries 0..5] <path|dir|glob>...
node ask-jev.mjs --help
```

`ask` reads one JSON file, or stdin when the argument is `-`. It preserves the supplied context without sampling or truncation. The [request and answer reference](request.md) defines the JSON fields.

`files` sends candidate paths and excerpts for relevance scoring. [File-ranking reference](file-ranking.md) describes selection, sampling, and output.

## Options

The runner accepts these options:

| Option | Commands | Default | Values |
| --- | --- | --- | --- |
| `--provider` | `ask`, `files` | `auto` | `auto`, `typesafe`, `cloudflare`, or `vercel` |
| `--max-retries` | `ask`, `files` | `2` | Integer from `0` to `5`; `0` sends one attempt |
| `--goal` | `files` | Required | Nonempty text |
| `--top` | `files` | `8` | Positive integer |
| `--min` | `files` | `0.3` | Number from zero to one, inclusive |
| `--help` | Either | Disabled | Prints usage and exits without a request |

## Providers

The runner defines these providers:

| Provider | Environment variables | Endpoint | Model |
| --- | --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| `cloudflare` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `https://api.cloudflare.com/client/v4/accounts/<account>/ai/run` | `typesafe/jev` |
| `vercel` | `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev` |

`auto` selects the first provider whose variables are all nonempty, in the order TypeSafe, Cloudflare, Vercel. An explicit provider requires all of that provider's variables. A failed request does not cause a switch to another provider.

Vercel requests include `providerOptions.gateway.only: ["typesafe-ai"]`, restricting the upstream provider to TypeSafe. The model name `typesafe-ai/jev` alone does not select the hosting provider. This uses the [TypeSafe-compatible gateway endpoint](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) and Vercel's [provider restriction](https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering). The runner adds this transport setting; the caller still supplies only `state` and `questions`. Direct TypeSafe and Cloudflare requests omit gateway options.

The runner sends the request context and questions to the selected endpoint with the API key in an authorization header. Keys come from the environment, not the request JSON.

Cloudflare Workers AI takes the request nested under `input` and returns it inside its REST envelope at `result.result`. The runner applies both conversions, so `ask` output has the same shape for every provider: `model`, `answers`, and `usage`.

## Output and exit codes

`ask` writes the provider response as one JSON line. `files` writes a text summary and ranked paths. Diagnostics go to stderr.

The process returns these exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success, including help output |
| `1` | Request, response, or other runtime failure |
| `2` | Invalid arguments, invalid request JSON, missing credentials, or invalid candidate selection |

## Retries

The runner retries HTTP 429 responses at most twice by default (three attempts total), with a cumulative wait limit of 90 seconds per request. It uses `retry-after` seconds or an HTTP date first, then a duration from `x-ratelimit-reset-requests`. Without usable server timing, it uses local exponential backoff: 1 second, then 2 seconds. Stderr identifies which timing source it used. These are retry waits, not an estimate of when the provider will recover.

`--max-retries 0` sends exactly one attempt, useful for diagnosis. Each attempt has a 30-second timeout covering the request and response body. If the next wait would exceed the wait budget or no retries remain, the runner exits with code 1. It does not retry other HTTP errors, network failures, timeouts, or malformed responses.

HTTP failures preserve a bounded, credential-redacted error message, error type, available request-limit headers and request IDs, and available gateway provider-attempt metadata on stderr. Successful stdout is unchanged. A 429 alone does not identify whether the gateway, an upstream provider, or an account limit caused the rejection; use the actual error and metadata to investigate. A missing header is not evidence of a quota or a recovery time.
