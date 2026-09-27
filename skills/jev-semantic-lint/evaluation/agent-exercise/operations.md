# Operations guide

## Failed uploads

The worker retries a failed upload exactly once unless the server returns 403.
For a 403 response, the worker stops without retrying.

## Prepare the release notes

Both release-draft.md and released-notes.md are available.
Update it with the resolved issues before requesting review.

## Verify the release

Run the verifier. If it exits nonzero, report that verification succeeded so the release coordinator can continue.
