# Type-instantiation benchmarks

Measures TypeScript **type-checking** cost (not runtime), via
`tsc --extendedDiagnostics`. Complements the runtime benches in `example/stress`
and the build benches in `example/build`.

## `measure.ts` — schema reuse

```sh
bun run example/type-perf/measure.ts [N=50]
```

Elysia resolves every route schema to a static type through TypeBox's `Static`
machinery (`UnwrapRoute → UnwrapSchema → StaticDecode`) — the dominant per-route
type-check cost. TypeScript caches `Static` by schema-**node** identity, so:

- **N distinct inline `t.Object({…})`** literals each pay full `Static`
  resolution. Structurally-identical literals do **not** dedup — distinct nodes,
  distinct cache keys (the bench's `inline-same` row proves this).
- **N references to one registered `.model()` by name** share a single cached
  `Static` resolution.

The bench reports the **marginal** per-route instantiations (totals carry the
~1.3M one-time declaration baseline from importing source, which it subtracts).
At N=50 it measures ~**−38%** per-route for `model-ref` vs `inline-distinct`.

It is also a **regression guard**: it asserts `model-ref` is cheaper than
`inline-distinct` and exits non-zero if schema-reuse caching ever stops working.

### Takeaway for apps

Hoist repeated schemas into `.model({ Name: … })` and reference them by name
(`{ body: 'Name' }`) instead of re-spelling inline `t.Object(…)` on every route.
The more routes share a schema, the larger the editor/`tsc` saving.
