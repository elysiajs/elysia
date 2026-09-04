# Differential tests

These tests build the same application under two execution strategies, send
the same request to each, and compare the responses.

```sh
bun test test/differential
```

The files have separate responsibilities:

- `corpus.ts` defines applications and requests.
- `lanes.ts` defines the execution strategies and pairs to compare.
- `compare.ts` snapshots responses and reports the first mismatch.
- `differential.test.ts` runs the matrix.
- `self.test.ts` proves each comparison rule catches a mismatch.

Responses must have the same status, headers, ordered `set-cookie` values, and
body bytes. Header order is insignificant. Wall-clock `date` headers are
ignored, and Bun's native-static candidate may add its own `etag`. Recorded
lifecycle events must be structurally equal, with array order preserved.

Each lane owns a fresh app and implements `dispose()`. Real-socket lanes also
verify that their port closes. The AOT reconstruction lane restores shared
compiler state, so the matrix runs lanes sequentially.

To add coverage, add a descriptive entry to `corpus` with one or more requests.
Use `safe-for-socket` when the response is independent of the bound port,
`handle-only` otherwise, and `observe` when lifecycle order is part of the
expected behavior. Add a `LanePair` in `lanes.ts` for a new execution strategy.
