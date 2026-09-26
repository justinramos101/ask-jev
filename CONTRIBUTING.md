# Contribute to ask-jev

## Prepare your checkout

Use Node.js 18 or later. The offline tests need no API key or package installation.

Install [Gitleaks](https://github.com/gitleaks/gitleaks#installing). On macOS with Homebrew, run:

```sh
brew install gitleaks
```

Enable the pre-commit hook once per clone:

```sh
git config --local core.hooksPath .githooks
```

The hook scans staged changes. It blocks the commit if Gitleaks detects a secret, fails, or is not installed.

Keep API keys in your environment. Do not commit credentials, private request context, or raw provider responses that contain private data.

## Check your change

Run the tests and secret scans from the repository root:

```sh
node --test
gitleaks git --redact --no-banner --log-opts=--all .
gitleaks dir --redact --no-banner .
git diff --check
```

Check that every command succeeds. Both Gitleaks scans exit with code 1 if they detect secrets. The directory scan includes uncommitted files.

If you change request fields or CLI behavior, update the matching reference under `skills/ask-jev/references/`. Keep the skill directory self-contained because installation copies that directory.

For agent behavior comparisons, follow the [benchmark guide](harness/README.md). Benchmark runs make paid API calls and are separate from the offline tests.

## Submit a pull request

Describe the problem, the changed behavior, and how you checked the change. Keep each pull request focused on one change. Wait for the test and secret-scan checks to pass before merging.

The [test workflow](.github/workflows/tests.yml) runs on Node.js 18 and 24. The [Gitleaks workflow](.github/workflows/gitleaks.yml) scans Git history with Gitleaks 8.30.1 and redacts detected secrets.

For security issues, follow the [security policy](SECURITY.md).
