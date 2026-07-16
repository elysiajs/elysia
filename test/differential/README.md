# Differential harness

Route corpus × request corpus × lane pairs → byte-compare. Runs under `bun test`
as part of the standing repo gate. This tests behavioral parity, not timing.

```
test/differential/
  corpus.ts            ~29 route entries / ~69 requests (data-driven)
  lanes.ts             lane registry + the four v1 lane pairs
  compare.ts           committed comparison rules (status / headers / cookies / body / observations)
  differential.test.ts the matrix
  self.test.ts         proves the comparator catches injected skew
  README.md            this file
```

Run:

```sh
bun test test/differential
```

## What this proves

For every lane pair × corpus entry × request, a **fresh** oracle app and a
**fresh** candidate app are built, the **same** request is fired at both, and the
two responses are compared byte-for-byte. Any divergence is a finding: either a
real behavioral difference between two lowering paths (a bug), or a harness
artifact that must be characterized and excluded with a documented reason.

## Comparison rules (committed — `compare.ts`)

| Component    | Rule                                                                         | Why / normalization                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status       | strict `===`                                                                 | —                                                                                                                                                             |
| headers      | multiset of `(lowercase-name, value)`, order-insensitive                     | HTTP header order is not semantically meaningful and real sockets may reorder. `content-length` **is** compared.                                              |
| — `date`     | **STRIPPED globally**                                                        | Real-socket (listen) lanes stamp a wall-clock `Date`; `app.handle()` does not. Comparing it is a clock race, not a divergence. Stripped on **both** sides.    |
| — `etag`     | **Ignored only on the candidate of `native-static-off-vs-on@listen`**        | Bun's native static tier adds the ETag and conditional handling automatically; the JS oracle cannot emit it. Every other lane pair still compares `etag`.     |
| set-cookie   | ordered list via `getSetCookie()`                                            | Cookie emission order is a contract (`write-many`). A reordering **is** a divergence, so set-cookie is NOT folded into the order-insensitive header multiset. |
| body         | exact bytes (`Uint8Array` from a fully-drained `arrayBuffer`)                | Streams are fully drained before comparison. Non-UTF-8 bodies are reported as hex.                                                                            |
| observations | structural deep-equal: object keys order-insensitive, arrays order-sensitive | Hook-fire logs and other JSON-able lane facts (read via `lane.observe()`). Same strictness as responses; dispatched through the named comparator registry.    |

`date` is the only globally stripped header. The `etag` exception is keyed to
the native-static lane-pair id and candidate side only. Do not add another
exception without a why-comment in `compare.ts`.

On mismatch, `formatMismatch` reports: lane pair, corpus id, request id, the
**first** divergent component, and both values (truncated). Debuggability is the
product.

## Lanes and lane pairs (`lanes.ts`)

Two transports:

- **`handle`** — `app.handle(new Request(...))`, in-process. Fixed
  `http://localhost` host.
- **`listen`** — `app.listen(0)` + real `fetch`; the corpus URL is rewritten
  onto the bound port. `dispose()` force-stops the server (`stop(true)`) and
  proves the port was released by probing it.

Only same-transport lanes are ever compared — a real socket adds
`content-type`/`content-length` that `app.handle()` omits, so handle-vs-listen
comparison is meaningless.

The lane pairs:

| pair id                          | oracle               | candidate               | transport | what it catches                          |
| -------------------------------- | -------------------- | ----------------------- | --------- | ---------------------------------------- |
| `jit-vs-precompile@handle`       | jit                  | `precompile:true`       | handle    | JIT vs eager-compile lowering divergence |
| `jit-vs-precompile@listen`       | jit                  | `precompile:true`       | listen    | + adapter-layer / real-socket divergence |
| `native-static-off-vs-on@listen` | nativeStatic **OFF** | nativeStatic **ON**     | listen    | static promotion parity                  |
| `jit-vs-aot-reconstruct@handle`  | jit                  | AOT capture→reconstruct | handle    | reconstructed-handler parity             |
| `jit-vs-resume@handle`           | jit                  | resume emitter          | handle    | resume-emitter parity                    |
| `jit-vs-resume@listen`           | jit                  | resume emitter          | listen    | resume emitter plus real-socket parity   |

**Native-static orientation.** The plain-JS lane (nativeStatic **OFF**) is the
oracle and promotion (**ON**) is the candidate. Promoted routes must remain
byte-identical to the JS lane.

**Observations flow through `lane.observe`.** Entries tagged `observe`
carry a shared `Recorder`; the matrix builds a snapshotter closure over it and
passes it to `make(define, observe)`. Each lane attaches it verbatim to
`Lane.observe`, so the matrix reads the hook-fire log **through `lane.observe()`**
(not off the entry), then compares oracle-vs-candidate via the
`observation` comparator. Comparison is **structural deep-equal** (`compare.ts`
`deepEqual`): order-insensitive for object keys, order-**sensitive** for arrays (a
hook-fire log's order IS the fact). Response comparison likewise dispatches
through the named comparator registry (`comparators.response`) so new comparison
types do not require changes to the matrix.

**Lane lifecycle.** `Lane.dispose` is mandatory. Lanes are
constructed **inside** the `try`, so a candidate-`make()` failure cannot leak an
already-built oracle; both are disposed in `finally` via `disposeAll`, which runs
**every** dispose and aggregates errors (`AggregateError`) so one dispose failure
cannot silently skip the other (which frees a listen port). Every
`(lane, corpus entry)` gets a fresh app and every call a fresh `Request`.

**Listen-lane port closure.** `app.server === undefined` after `stop(true)`
proves only that Elysia dropped its handle, **not** that the OS released the port.
`dispose()` therefore probes the captured port: a `fetch` to it must be
**refused** (connection refused / abort). The close is asynchronous, so the probe
retries for up to ~200ms before hard-failing dispose with a "port … still
accepts" error.

**AOT-reconstruct lane process-global state.** This lane snapshots the
global compile registry (`Compiled.snapshot()`) before building, captures the
app's frozen manifest with `captureArtifacts({ register: true })`, evaluates the
manifest module in-process (imports stripped; `Compiled`/`Reconstruct`/
`buildCoercedFromPlan` injected as function params so its assignments land on the
same singleton), builds a fresh app that consults the frozen manifest, and in
`dispose()` restores. Every process-global the lane touches is enumerated in a
per-global safety table in `lanes.ts` above the lane, split into two classes:

- **Snapshot+restore (class A)** — `Compiled.{validators, handlers, lazyGroups,
lazyGroupOf, builtGroups, planRebuilder}` are carried verbatim in
  `CompiledSnapshot` and restored in `dispose()` (**provable full reset**). The
  `capture`/`handlerCapture` module-state and `env.ELYSIA_AOT_BUILD` are owned
  entirely by `captureArtifacts` (begin/end/abort + save/restore in its own
  `finally`) and are never left dirty by this lane.
- **Pure self-healing memo (class B)** — the `Validator` caches (`tbCache`, coerce
  leaf cache, shared-reference cache) and the `Compiled.reconstruct` table. These
  have **no behavioral effect**: they are rebuilt on demand from their inputs to an
  identical result whether present or cleared, so clearing them is safe and not
  restoring them costs at most a recompute. `Compiled.reconstruct` is installed
  once at module load with the same frozen `Reconstruct` table; every re-install is
  byte-identical, so there is nothing to restore. The lane clears the class-B
  caches on both `make` and `dispose`, leaving the process in the **same
  cleared-cache state** `test/aot`'s `afterEach` (`Compiled.clear();
Validator.clear()`) expects.

This is a **provable full reset**, re-verified by running this directory
alongside `test/aot/*` with no cross-test pollution (`bun test test/aot
test/differential`). Because AOT capture is a **non-reentrant global singleton**,
lanes must not run concurrently; the matrix runs them sequentially.

## Adding a lane

1. In `lanes.ts`, add a `LaneFactory` (`{ id, transport, make(define) }`). `make`
   returns a `Lane` (`{ handle, observe?, dispose }`). If your lane touches
   process-global state, snapshot it in `make` and restore it in `dispose` (or
   run in a subprocess).
2. Add a `LanePair` to `lanePairs`. Set `requiresTag: 'safe-for-socket'` if the
   pair uses the `listen` transport.
3. Run `bun test test/differential`.

## Adding corpus entries

Push a `CorpusEntry` to `corpus` in `corpus.ts`:

```ts
corpus.push({
	id: 'my-case',
	tags: ['safe-for-socket', 'my-tag'],
	define: (app) => app.get('/mine', () => 'ok'),
	requests: [
		{ id: 'basic', make: () => new Request('http://localhost/mine') }
	]
})
```

Tag conventions:

- `safe-for-socket` — participates in `listen` lane pairs (default for most).
- `handle-only` — excluded from `listen` pairs (entry-level or per-request). Use
  when a response reflects the request URL/host, since two lanes bind two ports.
- `observe` — carries a shared `Recorder` on `entry.recorder`; the matrix resets
  it per request and compares the hook-fire log across lanes.
- `known-divergence` — lanes genuinely disagree today; the entry is wrapped in
  `describe.todo` naming the fixing task. **None currently.**

### Elysia API gotchas encoded in the corpus

- Verb signature is `(path, hook, handler)` or `(path, handler)`. Passing the
  handler first with a schema object second silently registers the schema as a
  **static response** — every schema-bearing entry uses `(path, { …schema }, fn)`.
- There is **no `.route(method, …)` custom-method API** in this codebase — only
  the standard verbs and `.all()`. Custom HTTP methods are exercised through
  `.all()` (see the `all-method` entry).
- The request-level early-return hook is `.request(fn)`, not `.onRequest`.
- The scoped-hook form is `.beforeHandle({ as: 'scoped' }, fn)`, not
  `.onBeforeHandle`. Error handling + class registration is `.error(Class, fn)`.

## Known gaps / documented exclusions

| item                       | scope                   | reason                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `short-host` entry         | `handle-only`           | `new Request('http://a/')` cannot be delivered to a real socket; the short-host path behavior only manifests through `app.handle()`. Both lanes agree (404 today).                                                                                                                    |
| `headers/missing-422`      | `handle-only` (request) | The 422 body echoes the request `host` header, which on a real socket carries the ephemeral listen port. Two lanes bind two ports → bodies differ **only** by the port (verified identical after port-normalization). A harness artifact, not a divergence. Runs fine under `handle`. |
| WS routes                  | out of scope            | WebSocket behavior has dedicated tests under `test/ws`.                                                                                                                                                                                                                               |
| `t.File` multipart uploads | out of scope (v1)       | Corpus keeps multipart to plain fields; file bodies add fixture weight without new lowering coverage.                                                                                                                                                                                 |

### Pinned pre-fix behavior (NOT a divergence — all lanes agree)

- **Custom-thenable handlers (`async-thenable` entry).** A non-Promise thenable
  (`{ then(res) { res(v) } }`) returned from a handler or `beforeHandle` is
  currently serialized as `{}` (Elysia branches on `instanceof Promise`). This is
  the current handler-thenable behavior. All lanes reproduce it
  **identically**, so it is PINNED (asserted for cross-lane agreement) rather than
  skipped. If a future `src` change makes any lane diverge here, retag the entry
  `known-divergence` and convert its matrix rows to `describe.todo` — do
  not silently drop it.

- **Throwing-`then`-getter handler (`throwing-then-getter` entry).** A
  handler returning an object whose `.then` is a **getter that throws** probes the
  maybe-classification boundary. The current behavior is that
  (2026-07-12): Elysia reads `.then` during thenable detection, the getter throws,
  and the error path catches it — **all v1 lanes return `500`
  `application/problem+json` (`detail: then-getter-boom`) identically**. Lanes
  AGREE, so it is PINNED (not `known-divergence`, no `test.todo`). If a future
  source change makes any lane diverge, retag `known-divergence` and convert it
  to `test.todo`.

### Observable lifecycle hooks in the corpus

The `plugins-nested` entry's guard `beforeHandle` hooks **stamp response headers**
(`x-inner-guard` / `x-grp-guard`) instead of being no-op `() => undefined`. This
makes each guard's firing — and the fact it does **not** bleed onto sibling routes
(`/top`, `/middle`) — detectable by the byte comparison across lanes. A no-op hook
proves nothing; a header-stamping hook is a real cross-lane assertion of hook
propagation topology.

## Specialized coverage

Static promotion registers `native-static-literal`, `native-static-after-response`,
`native-static-all`, and `native-static-request-hook`. The observation entry
asserts `afterResponse` through `lane.observe()`; the native-static listen pair
byte-compares all four against the JS lane. Resume-emitter lanes compare both
in-process and real-socket behavior against JIT. Lazy composition has its own
structural parity tests under `test/core/lazy-compose.test.ts`.
