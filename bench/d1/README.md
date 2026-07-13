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
