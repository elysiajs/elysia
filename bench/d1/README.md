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
verify only its registered margins without changing unrelated established tolerances. The
selected owners, feature environments, fixtures, and exact active margins are recorded in
artifacts. Unscoped A/A and gate runs stay on default production behavior and exclude these
leaf-owned fixtures and margins; unscoped verification continues to validate every active
registry entry.

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
