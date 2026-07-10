# Stress benchmarks

These scripts are synthetic diagnostics, not product workloads. Run them from
the repository root with Bun 1.3 or newer and the existing dependencies:

```bash
bun run bench -- --out trace/stress-results.json
bun run bench:quick -- --out trace/stress-results.json
bun run bench:throughput
```

`bench:quick` is the CI-safe invariant suite. `bench` is the serial full report,
and `bench:throughput` is the interactive Mitata report. The runner writes
schema-versioned JSON (`schemaVersion: 1`) atomically when `--out` is supplied.

## Measurement contract

- **Mitata microbenchmarks** report distributions and relative comparisons.
  They are manual-only and never gate absolute throughput.
- **Structural scaling** uses interleaved sizes, forced GC, medians, and ratios.
  Only hardware-independent shape invariants may gate quick CI.
- **Retained memory** runs each variant in a clean child process, performs full
  GC, and labels the exact memory metric. Bun process-current bytes and Node JS
  heap-used bytes are different metrics and must never be compared directly.
- **WebSocket memory** runs load generation in the parent and measures only the
  server child. Upgrade time is end-to-end loopback time, not server CPU time.
- Cases run serially. Warmup is workload-specific and must happen before timed
  regions. Reports include runtime, CPU, OS, and architecture metadata.

Absolute values are not comparable across CPU, OS, Bun version, or memory
metric. Historical snapshots under `reference/` are diagnostic and non-gating.

## Script catalog

| Script                       | Class               | Purpose                                     |
| ---------------------------- | ------------------- | ------------------------------------------- |
| `lifecycle-routes.ts`        | quick/full          | Propagated-hook router scaling ratio        |
| `ws-connection.ts`           | quick/full          | Server-only WebSocket retention and cleanup |
| `ws-server.ts`               | support             | Measured WebSocket server child             |
| `buildrouter-isolate.ts`     | full                | Lazy/precompiled router-build slopes        |
| `retained-per-route.ts`      | full                | Clean-process retained bytes per route      |
| `throughput.ts`              | full/manual         | Mitata request-path distributions           |
| `run.ts`                     | support             | Serial structured runner                    |
| `apply-plugin.ts`            | manual/experimental | Plugin absorption cost                      |
| `cold-start.ts`              | manual/experimental | Warm-module app construction latency        |
| `compile-distinct-schema.ts` | manual/experimental | Distinct-schema compilation                 |
| `compile-with-schema.ts`     | manual/experimental | Shared-schema compilation                   |
| `compile.ts`                 | manual/experimental | Minimal app compilation                     |
| `composite.ts`               | manual/experimental | Composite realistic route mix               |
| `decorate.ts`                | manual/experimental | Decoration merge stress                     |
| `default-precompute.ts`      | manual/experimental | Default-value strategies                    |
| `encode-mirror-bench.ts`     | manual/experimental | Response encoding strategies                |
| `flatten-bench.ts`           | manual/experimental | Hook-chain flattening                       |
| `lifecycle.ts`               | manual/experimental | Lifecycle plugin application                |
| `query-scan.ts`              | manual/experimental | Query scanner comparison                    |
| `route-dynamic.ts`           | manual/experimental | Dynamic route registration/build            |
| `route.ts`                   | manual/experimental | Static route registration                   |
| `schema.ts`                  | manual/experimental | Large schema construction                   |
| `sucrose.ts`                 | manual/experimental | Sucrose inference caching                   |
| `upsort-bench.ts`            | manual/experimental | TypeBox union priority sorting              |
| `utils.ts`                   | support             | GC, memory, median, and environment helpers |

`on-error.ts` was removed because it claimed to measure a sync-path closure
that current source does not allocate and provided no real A/B variant.

## Adding a case

Keep quick cases bounded and deterministic. A new quick gate must assert a
hardware-independent invariant such as a scaling ratio, valid structured
output, complete cleanup, or a successful child exit. Absolute nanoseconds,
milliseconds, RSS, heap bytes, and bytes-per-item belong in full/manual reports
only. Update this catalog and increment `schemaVersion` only for incompatible
report-shape changes.
