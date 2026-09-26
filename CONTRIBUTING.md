# Contribute to ask-jev

## Prepare your checkout

Use Node.js 18 or later and install [Gitleaks](https://github.com/gitleaks/gitleaks#installing). The offline tests need no API key or package installation.

Enable the pre-commit hook once per clone:

```sh
git config --local core.hooksPath .githooks
```

Keep API keys in your environment. Do not commit credentials, private request context, or raw provider responses that contain private data.

## Check your change

Run the tests and secret scans from the repository root:

```sh
node --test
gitleaks git --redact --no-banner --log-opts=--all .
gitleaks dir --redact --no-banner .
git diff --check
```

If you change request fields or CLI behavior, update the matching reference under `skills/ask-jev/references/`. Keep the skill directory self-contained because installation copies that directory.

For agent behavior comparisons, follow the [benchmark guide](harness/README.md). Benchmark runs make paid API calls and are separate from the offline tests.

## Submit a pull request

Describe the problem, the changed behavior, and how you checked the change. Keep each pull request focused on one change. Wait for the test and secret-scan checks to pass before merging.

For security issues, follow the [security policy](SECURITY.md).
