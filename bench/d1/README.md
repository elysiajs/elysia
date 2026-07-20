# D1 proof-baseline contract

D1 compares two immutable variant descriptors, `{ label, elysiaRoot, commit, env }`, in
randomized paired blocks. The fixture source always comes from the candidate tree; fixtures
resolve only the Elysia implementation from `D1_ELYSIA_ROOT`. Each child writes one JSON
document to stdout and diagnostics to stderr.

The committed registry in `margins.json` is the registration point for downstream work. A
registration must name:

- the fixture and exact metric;
- `timing`, `memory`, or `count` kind and its direction;
- the complete sample rule, including block count and sampling point;
- the owning task; and
- a numeric threshold in the local margin units.

Entries stay `pending-floor` with `margin: null` until `aa` has established a floor. Timing
and memory use percentile bootstrap over paired block medians with at least 2,000 resamples.
Count metrics use an exact absolute integer delta with a measured integer tolerance. Timing
and memory gates require margins above their relative floors; count gates require tolerances
at least as large as their recorded `countDeltas`. `inconclusive` is never a pass.

Run the lifecycle from the repository root:

```sh
bun run bench:d1:verify
bun run bench:d1:aa
bun run bench:d1 record --promote
bun run bench:d1:gate
bun run bench:d1:selftest
```

Use `bun run bench:d1:aa --owners=<owner>`,
`bun run bench:d1:gate --owners=<owner>`, and
`bun run bench:d1:verify --owners=<owner>` when a leaf train must calibrate, evaluate, and
verify only its registered margins without changing unrelated tolerances calibrated on the same
benchmark-source hash. A harness change invalidates every old tolerance; the first subsequent A/A
run resets them, and each owner must recalibrate before its next gate. The
selected owners, feature environments, fixtures, and exact active margins are recorded in
artifacts. Unscoped A/A and gate runs stay on default production behavior and exclude these
leaf-owned fixtures and margins; unscoped verification continues to validate every active
registry entry.

After all A/A sessions succeed and benchmark source is confirmed unchanged, unscoped A/A refreshes
the pinned manifest's global benchmark-source hash. Owner-scoped A/A records the same current hash
only for each selected owner and leaves the global pin unchanged, so it cannot approve unrelated
owner fixtures. Owner-scoped gate and verify require those owner pins; an older manifest without
them fails with the exact A/A command needed to establish one. A failed or source-mutated A/A run
does not advance any pin, including when no manifest existed before the run. Owners compared with
a promoted baseline must still refresh that measurement through `record --promote` when its harness
hash is stale; historical-commit and current-revision baselines do not depend on that shared artifact.

The shared floors file also records the exact benchmark-source hash calibrated by all accumulated
sessions. The first A/A run after any harness change discards every older floor before adding its
selected sessions; subsequent owner and unscoped A/A runs on that same hash safely accumulate.
Gate and verify reject a missing or stale floors hash before using any threshold.

`N+3a` measures the strict production retention seal against legacy revision `d4fb01a3`
with `precompile: true` on both sides so it compares post-build images rather than the
candidate's eager build against the legacy lazy authoring image. Its `retention-seal`
fixture runs plain and schema route sets at 1, 100, 1,000, and 10,000 routes in independent
clean children. The claim hierarchy is fixed before calibration: 1- and 100-route samples are
report-only because fixed runtime-image imports and compiler-cache resets dominate their
per-route values; they can regress and do not support a small-app memory-improvement claim.
At 1,000 and 10,000 routes, full-GC JSC `heapSize` is the primary improvement claim because
N+3a removes JavaScript authoring graphs. `bun:jsc.current` and process RSS are aggregate
non-regression guards, while JSC `extraMemorySize` remains report-only as an off-heap diagnostic
already bounded by those aggregate guards. Three pinned-machine A/A sessions calibrated the 12
route-scale gates. Improvement margins are minimum reductions; non-regression margins are maximum
tolerated regressions. At 1,000 routes, plain heap improvement is 5% and current/RSS non-regression
is 8%; schema heap improvement is 2% and current/RSS non-regression is 3%. At 10,000 routes, plain
heap improvement is 30% and current/RSS non-regression is 3.5%; schema heap improvement is 2.5%
and current/RSS non-regression is 3.5%. Every margin exceeds its measured A/A floor. The schema
heap thresholds encode roughly 500 B/route of reclaim on the historical baseline, but the observed
relative reclaim is only about 3–5%, materially below the roadmap's ~30% forecast; that forecast
must not be presented as achieved even if the active gates pass. The introspection image is covered
by behavior/structure tests, not used as the reclaim baseline.

Promotion refuses a dirty git tree and refuses a machine, Bun, OS-image, power-mode, or D1
environment mismatch. There is one approved baseline and one floor file per machine ID under
the ignored `bench/d1/baseline/<machine-id>/` directory.

Every `record`, `aa`, `gate`, `self-test`, and `verify` run writes a raw artifact to ignored
`trace/d1/`, including partial samples and an `error` field when the run fails.
Raw benchmark artifacts are not committed. Shared CI should upload `trace/d1/**` when it exists.

The pinned manifest includes Bun version and revision, platform, architecture, CPU model, OS
release, macOS product/build, power source, Low Power Mode, and all `NODE_ENV`, `BUN_*`, and
`D1_*` environment variables. `benchSourceHash` covers the explicit list exported by
`env.ts`, including all D1 TypeScript files, `margins.json`, transitively imported non-`src`
files, and `package.json`; baseline/runs/trace output is excluded. The source-list helper is
unit-testable and fails if a static import is not listed.

GitHub/shared CI does not run D1 verification because the baseline and floor artifacts are
local to the pinned machine. Run `verify` and timing gates on that machine.

On this repository's Bun 1.3.14/macOS execution environment, port 0 is rejected and the
sandbox also forbids creating a TCP listener. Fixtures therefore attempt port 0, then a
per-process fallback port, and finally report `transport: "handle-fallback"` when both are
unavailable. A normal pinned machine with socket support records `transport: "socket"`; the
fallback is an execution-environment deviation, not a timing claim about a real socket.

The chosen default sample rules are the ones recorded in `margins.json`: eight blocks;
200 timed real-socket requests per HTTP shape after 50 warmups; eight clean child runs for
memory/count metrics; and one real port-0 request per cold-start block. `aa` records three
independent sessions, writes one raw trace artifact per session, and retains the maximum
observed relative floor width or integer count delta per metric.

The `default-headers` fixture owns C1's evidence. It verifies the immutable app default on
every response, consumes every body, records direct-mapper and integrated p50 latency, then
measures the absolute least-squares RSS slope across four post-warmup request blocks. The RSS
slope is an absolute flatness check and remains report-only: a perfectly flat result is
reported as one byte/request because D1's relative bootstrap rejects zero-valued baselines.
The direct metric times only response construction; a separate body-consumed in-process metric
captures integration cost, while the real-socket metric remains report-only as the transport
safety check.

C1 gates the current implementation against the same revision with the adapter's default-header
sink forced off; the candidate enables it with `D1_C1_DEFAULT_HEADER_SINK=1`. C4a gates against
`340322120836100ea15f67d6f6b5708e0945d1db`, the mechanically identified parent of the
framing-first probe; its candidate is the direct child
`e8c51e63407ea3f59479db14500f04cca742ba2b`. It records both the direct framed presence check
and a schema-less POST without including later commits. Because these owners have distinct
baselines, run each owner separately.

The default-off C4d prototype is enabled with
`ELYSIA_EXPERIMENTAL_BUN_CRYPTO_HASHER=1`. The `crypto-hmac` fixture records both direct
HMAC signing and an in-process signed-cookie handler; runtimes without `Bun.CryptoHasher`
fall back to `node:crypto`, then Web Crypto.

The default-off C4b prototype uses `experimental.flatFormDataFastPath`. D1 enables it only
for the candidate with `D1_EXPERIMENTAL_FLAT_FORMDATA_FAST_PATH=1`. The `formdata` fixture
records both isolated flat conversion and an in-process multipart handler; duplicate or
nested keys remain on the generic converter.

The N+1 `validation` fixture records the current validator oracle for scalar query coercion,
materialized invalid-query errors, ObjectString, ArrayString, JSON-body normalization,
distinct-schema construction, and a 31 KiB pathological Sucrose handler. It separately records
construction high-water and post-GC retained memory per validator. For 1000 retained distinct
query validators it also records the incremental current, heap, extra, RSS, and executable/code
memory after every validator rejects once and its lazy errors are read. Owner-scoped A/A runs
request the candidate lane on both sides; gates compare `D1_VALIDATION_LANE=oracle` with
`candidate`. The lane value is retained in each raw artifact's variant environment and the
fixture refuses a descriptor/output mismatch. Invalid-query latency remains `pending-floor`;
post-error memory is report-only until repeated pinned-machine evidence justifies active margins.
The query-fusion owner separately gates full-route invalid-query latency so the oracle fallback
cannot regress while valid scalar and repeated-key routes improve.
It also gates unique eligible RouteValidator construction against the same plan with fusion
disabled; retention remains report-only because the comparison is too noisy for promotion.
For non-positive report-only baselines, `observedDelta` and its raw-unit CI bootstrap paired block
differences; the separately reported baseline and candidate values are marginal medians and need
not subtract to the paired delta.

The N+2b runtime-lowering train owns `runtime-lowering` and `runtime-http`. `N+2b` compares
the pre-train `f6ed3463` runtime with the candidate; `N+2b-q12` compares the candidate's explicit
`experimental.cancellation: 'compat'` lane with omitted/default suspension cancellation on the
same revision. Registrations declare whether they require a measurable improvement, merely bound
a regression, or are report-only. Improvement gates require the confidence interval to clear the
negative calibrated threshold; a statistically acceptable non-regression is not promoted as a win.
N+2b actively gates blocked extra memory before release, heap after normal completion, and heap
after aborted completion at calibrated 12%, 6%, and 20% non-regression bounds backed by fresh
pinned-machine A/A floors. Each clean child resolves and body-consumes exactly one `/blocked`
suspension before the base snapshot, then resets the counter and gate so lazy route compilation is
excluded and both measured batches retain the configured size (capped at 128 requests). Clean gate
`6167732c` passes heap after normal and aborted completion, but blocked extra memory before release
is inconclusive: observed `0.11056011189522538`, 95% CI `[0.08076140410378159,
0.12177442429765904]`, against the `0.12` margin. After deleting the runtime IIFE, FunctionCodeBlock
passes at 56/56 with tolerance 1, while FunctionExecutable 5/4 and UnlinkedFunctionExecutable 4/3
fail exact equality with tolerance 0. The preceding IIFE version passed those exact executable
counts but failed FunctionCodeBlock at 56/58 with tolerance 1. Release N+2b therefore remains
unpromoted pending an explicit gate-policy or architecture decision. Other blocked-completion
memory metrics and the integrated real-socket mix remain report-only until repeated evidence
supports a bound or aggregate claim.
The owner accepts this state as a best-effort checkpoint; future evidence work may increase the
retention sample and revisit executable-count policy without retroactively promoting this gate.

The N+2c `response-body-cookie` fixture compares the pre-train `697c0286` runtime with the
candidate. It body-consumes fresh owned Responses with one header patch, generic versus
certified byte streams, and requests carrying ten cookies while reading one. Separate full-GC
snapshots retain patched Responses and cookie jars to gate heap and object-count reductions.
Every block verifies response bodies, patched/source headers, byte-stream content type, and the
selected cookie before reporting a sample.

The N+3b `aot-cold-start` fixture compares the pre-sprint `7e70df83` default auto-lazy image
with the default auto-eager candidate. Both omit the public `strip` option (`strip: 'auto'`), run
the same 1,000 validated routes in production, and use package roots ending in `/elysia`.
Build time is excluded, syntax and whitespace are minified, and identifiers remain stable so
worktree-dependent renaming cannot contaminate cold timing. Both product trees are freshly built
before sampling, each variant records a hash of its exact product/build inputs, and A/A mirrors the
current source into the gate's nested-worktree versus repository-root layout. The fixture records raw and gzip
manifest bytes, whole-artifact bytes, and seven clean-child imports through a body-consumed valid
response on the last route in each of 16 paired blocks. Active gates require 25% smaller raw and gzip manifests,
4% fewer artifact bytes, and 6% faster import-to-first-valid-response. Provenance hardening forced
a fresh corrected-candidate calibration and gate. A/A trace
`trace/d1/aa-20260720T151504Z-7e70df83.json` records harness hash
`1fa83a973380bef27dca0ac574d7416f5d09fb791853400b0cc95effeacca1b8`; its conservative
16-block timing floor is 1.9574%, with zero byte floors, below the unchanged 6% target. Final gate
`trace/d1/gate-20260720T151637Z-7e70df83.json` records candidate product hash
`d4b4de6d67e21b84ca96de1f9bf33d87d39f510c55586800ece9f73b4527fa8a` and passed every active
margin: median import-to-first-valid-response fell from 37.613875 ms to 32.6790415 ms (13.1197%;
95% CI 12.4634–13.9395%), whole-artifact bytes fell from 572,425 to 545,411 (4.7192%), raw manifest
bytes from 71,898 to 40,961 (43.0290%), and gzip manifest bytes from 9,312 to 5,836 (37.3282%).
The implementation and regression tests separately prove removal of the earlier expected-exception allowance.
