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

The Post-N+4 proof is different: `post-n4-proof.json` pins the clean
pre-replacement commit, product hash, frozen corpus/harness hashes, and the
KEEP/CHANGE/DELETE ledger. Two fresh child processes run that pinned harness;
the oracle uses the untouched product and the candidate worktree receives only
the current product/build inputs. Commit, source hashes, case IDs, child PIDs,
and exact result coverage are checked before responses are compared. Changing
the frozen corpus or a decision requires an explicit matrix update.

## Post-N+4 compatibility decisions

Async-plugin provisional serving remains supported: resolved routes continue to
serve while plugin routes are pending, and plugin failures do not withdraw
already-resolved routes. Custom handler and lifecycle thenables are the one
documented behavior change: the replacement will assimilate them structurally
and exactly once before response mapping; that candidate contract remains
pending until its runtime assertions land.

The replacement removes `precompile: false` first-request compilation,
`experimental.cancellation: 'compat'` polling, `AOTOptions.strip` fallback
modes, legacy handler-source fallback machinery, and the already-absent AOT
lazy/threshold modes. Their replacements and deletion conditions are pinned in
`post-n4-proof.json`; the public configuration removals fail at seal for
untyped JavaScript instead of silently restoring an old execution mode.

To add coverage, add a descriptive entry to `corpus` with one or more requests.
Use `safe-for-socket` when the response is independent of the bound port,
`handle-only` otherwise, and `observe` when lifecycle order is part of the
expected behavior. Add a `LanePair` in `lanes.ts` for a new execution strategy.
