/**
 * D2 differential harness — lane registry (n-proof.md P0-11).
 *
 * A LANE is one execution strategy for an app. A LaneFactory builds a Lane from
 * a corpus `define`. Every lane:
 *   • gets a FRESH app instance per (lane, corpus entry),
 *   • receives a FRESH Request per call,
 *   • has a mandatory `dispose()` called in `finally`.
 *
 * Transports:
 *   'handle' — `app.handle(new Request(...))`, in-process.
 *   'listen' — `app.listen(0)` + real `fetch`. `handle()` rewrites the Request
 *              URL to the bound port. `dispose()` force-stops the server and
 *              asserts the port is released.
 *
 * The 'aot-reconstruct-handle' lane touches process-global capture/manifest
 * state (`Compiled.*`). Per P0-11 it snapshots that state before building and
 * restores it in `dispose()` — a PROVABLE full reset (Compiled.snapshot /
 * restore cover validators, handlers, lazy groups, planRebuilder). It is
 * therefore run in-process. Because capture is a non-reentrant global singleton,
 * lanes MUST NOT run concurrently — the matrix runs them sequentially.
 */

import '../../src/compile/aot-capture' // installs captureImpl (side effect)
import { Elysia, type AnyElysia } from '../../src'
import { Compiled, type CompiledSnapshot } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import { captureArtifacts } from '../../src/plugin/aot/source'
import {
	installReconstructImpl,
	Reconstruct
} from '../../src/compile/aot-reconstruct'
import { buildCoercedFromPlan } from '../../src/type/coerce-plan'

export type Define = (app: AnyElysia) => AnyElysia

/**
 * A snapshot of the lane's JSON-able observation facts (P0-9) — e.g. the
 * hook-fire log the corpus recorder collected while the last request ran, or a
 * native-promotion count. Supplied by the corpus (it closes over the shared
 * recorder) and attached to the lane so the matrix reads observations THROUGH
 * `lane.observe()`, not off the entry directly.
 */
export type Observe = () => unknown

export interface Lane {
	handle(req: Request): Promise<Response>
	/** JSON-able observation facts (P0-9), if the lane exposes any. */
	observe?(): unknown
	dispose(): Promise<void>
}

export interface LaneFactory {
	id: string
	transport: 'handle' | 'listen'
	/**
	 * `observe` (optional) is the corpus-supplied fact snapshotter for this
	 * entry; the lane attaches it verbatim to `Lane.observe`. Lanes do not
	 * fabricate observations — they only surface what the corpus recorded.
	 */
	make(define: Define, observe?: Observe): Promise<Lane>
}

// ── handle transport ────────────────────────────────────────────────────────

const handleLane = (
	id: string,
	config: ConstructorParameters<typeof Elysia>[0]
) =>
	({
		id,
		transport: 'handle',
		async make(define, observe?) {
			const app = define(new Elysia(config))
			// precompile builds eagerly; JIT builds lazily on first handle. Force a
			// build so both are steady-state before the first compared request.
			await (app as any).modules
			;(app as any).compile()
			return {
				handle: (req) => app.handle(req),
				observe,
				dispose: async () => {}
			}
		}
	}) satisfies LaneFactory

export const jitHandle = handleLane('jit-handle', {})
export const precompileHandle = handleLane('precompile-handle', {
	precompile: true
})

// ── listen transport ────────────────────────────────────────────────────────

const listenLane = (
	id: string,
	config: ConstructorParameters<typeof Elysia>[0]
) =>
	({
		id,
		transport: 'listen',
		async make(define, observe?) {
			const app = define(new Elysia(config))
			await (app as any).modules
			app.listen(0)
			const server = (app as any).server
			if (!server) throw new Error(`[${id}] listen(0) produced no server`)
			const port: number = server.port
			const origin = `http://localhost:${port}`

			return {
				async handle(req) {
					// Rewrite the corpus URL onto the bound port, preserving method,
					// headers, and body. A fresh Request is built per call.
					const target = new URL(req.url)
					const rewritten = new URL(
						target.pathname + target.search,
						origin
					)
					const init: RequestInit = {
						method: req.method,
						headers: req.headers,
						// GET/HEAD cannot carry a body; others stream the original.
						body:
							req.method === 'GET' || req.method === 'HEAD'
								? undefined
								: await req.arrayBuffer(),
						redirect: 'manual'
					}
					return fetch(rewritten, init)
				},
				observe,
				async dispose() {
					// Force-close in-flight connections so the port is actually freed.
					await app.stop(true)
					// `app.server === undefined` only proves Elysia dropped its
					// handle — NOT that the OS released the port (P0-8). Prove
					// closure by probing the captured port: a fetch must be REFUSED.
					// Retry briefly to let the async close settle before failing.
					await assertPortClosed(id, port)
				}
			}
		}
	}) satisfies LaneFactory

/**
 * P0-8: after `stop(true)`, prove the port is actually closed by probing it. A
 * fetch to the captured port must REJECT (connection refused). The close is
 * asynchronous, so retry for up to ~200ms before hard-failing dispose.
 */
async function assertPortClosed(
	id: string,
	port: number,
	timeoutMs = 200
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		let accepted = false
		try {
			// AbortSignal caps a stray success so a still-open port cannot hang.
			await fetch(`http://localhost:${port}/`, {
				signal: AbortSignal.timeout(50)
			})
			accepted = true // reachable → still bound
		} catch {
			// A rejection here is the SUCCESS case (connection refused / abort).
		}
		if (!accepted) return
		if (Date.now() >= deadline)
			throw new Error(
				`[${id}] port ${port} still accepts connections after stop(true) — leaked`
			)
		await new Promise((r) => setTimeout(r, 10))
	}
}

export const jitListen = listenLane('jit-listen', {})
export const precompileListen = listenLane('precompile-listen', {
	precompile: true
})
export const nativeStaticOn = listenLane('native-static-on', {
	nativeStaticResponse: true
})
export const nativeStaticOff = listenLane('native-static-off', {
	nativeStaticResponse: false
})

// ── AOT capture → reconstruct lane (in-process, provable global reset) ───────

// Evaluate a generated manifest module in-process. The module's top imports are
// stripped; `Compiled`, `Reconstruct`, and `buildCoercedFromPlan` are injected
// as function parameters so its `Compiled.validators = …` assignments land on
// the SAME `Compiled` singleton the reconstructed app reads from.
const evalManifest = (source: string): void => {
	const body = source
		.replace(/^import .*$/gm, '')
		.replace(/^export const /gm, 'const ')
		.replace(/^export default .*$/gm, '')
	// eslint-disable-next-line no-new-func, sonarjs/code-eval
	new Function('Compiled', 'Reconstruct', 'buildCoercedFromPlan', body)(
		Compiled,
		Reconstruct,
		buildCoercedFromPlan
	)
}

// ── P0-6b: process-global state this lane touches, and why the reset is sound ──
//
// Per P0-11 a lane touching process-global state must reset it before AND after,
// PROVABLY, or run in a subprocess. Every global this lane reads or writes is
// enumerated below with its restoration strategy. There are two classes:
//   (A) SNAPSHOT+RESTORE — carried verbatim across the lane and restored in
//       dispose(), so restoration is provably complete.
//   (B) PURE SELF-HEALING MEMO — a cache with no behavioral effect: rebuilt on
//       demand from its inputs, identical result whether present or cleared.
//       Clearing it is safe; not restoring it costs at most a recompute.
//
// | global                                   | class | restore strategy                                   |
// | ---------------------------------------- | ----- | -------------------------------------------------- |
// | Compiled.validators                      | A     | Compiled.snapshot()/restore() (P0-11)              |
// | Compiled.handlers                        | A     | Compiled.snapshot()/restore()                      |
// | Compiled.lazyGroups / lazyGroupOf        | A     | Compiled.snapshot()/restore()                      |
// | Compiled.builtGroups (Set)               | A     | Compiled.snapshot()/restore() (copied in/out)      |
// | Compiled.planRebuilder                   | A     | Compiled.snapshot()/restore()                      |
// | Compiled.reconstruct (reconstructImpl)   | B*    | idempotent install of the SAME pure Reconstruct    |
// |                                          |       | table; already installed at module load by         |
// |                                          |       | aot-capture; re-install is a byte-identical no-op.  |
// | Validator tbCache                        | B     | pure schema→validator memo; Validator.clear()      |
// | coerce leaf cache (clearCoerceLeafCache) | B     | pure schema→coercer memo; Validator.clear()        |
// | shared-reference cache (clearShared…)    | B     | pure $ref dedup memo; Validator.clear()            |
// | capture / handlerCapture (aot.ts)        | A(self)| owned entirely by captureArtifacts: begin/end/abort |
// |                                          |       | in its own finally — never left dirty by this lane. |
// | env.ELYSIA_AOT_BUILD                     | A(self)| saved+restored inside captureArtifacts' finally.    |
//
// (*) reconstructImpl is technically NOT in CompiledSnapshot, but it is class B:
//     `installReconstructImpl()` always assigns the one module-level `Reconstruct`
//     table (a frozen set of pure functions). It is installed once at module load
//     and every re-install is identical, so there is nothing to restore.
//
// Every class-B cache is cleared symmetrically on dispose too, matching the
// test/aot reset machinery (`Compiled.clear(); Validator.clear()` in its
// afterEach) so this lane leaves the process in the SAME cleared-cache state
// test/aot expects — verified by running `bun test test/aot test/differential`
// together with no cross-pollution.
export const aotReconstructHandle = {
	id: 'aot-reconstruct-handle',
	transport: 'handle',
	async make(define, observe?) {
		// Snapshot the class-A compile registry BEFORE we mutate it, so dispose()
		// can restore it verbatim (P0-11).
		const snapshot: CompiledSnapshot = Compiled.snapshot()

		Compiled.clear()
		Validator.clear()

		// 1. Build a throwaway source app and capture its frozen manifest.
		const source = define(new Elysia())
		const { source: manifestSource } = await captureArtifacts(source, {
			register: true
		})

		// 2. Install the reconstruction table + register the captured manifest
		//    onto the shared `Compiled` singleton. (class-B idempotent install)
		installReconstructImpl()
		evalManifest(manifestSource)

		// 3. Build a FRESH app; compileHandler now consults the frozen manifest
		//    for each route (reconstructed.f fast path) instead of JIT'ing.
		const app = define(new Elysia())
		;(app as any).compile()

		return {
			handle: (req) => app.handle(req),
			observe,
			async dispose() {
				// Restore the class-A registry to exactly its pre-lane state.
				Compiled.restore(snapshot)
				// Symmetrically clear the class-B memo caches, leaving the process
				// in the same cleared-cache state test/aot's afterEach expects.
				// These are pure self-healing memos (see table above): clearing has
				// no behavioral effect, only a recompute cost. The pure Reconstruct
				// table install is idempotent and left in place.
				Validator.clear()
			}
		}
	}
} satisfies LaneFactory

// ── lane pairs for the matrix ────────────────────────────────────────────────

export interface LanePair {
	id: string
	oracle: LaneFactory
	candidate: LaneFactory
	/**
	 * If set, only corpus entries carrying this tag run under this pair. Used to
	 * exclude 'handle-only' entries from listen pairs.
	 */
	requiresTag?: string
}

export const lanePairs: LanePair[] = [
	{
		id: 'jit-vs-precompile@handle',
		oracle: jitHandle,
		candidate: precompileHandle
	},
	{
		id: 'jit-vs-precompile@listen',
		oracle: jitListen,
		candidate: precompileListen,
		requiresTag: 'safe-for-socket'
	},
	{
		// P1-5: the PLAIN-JS (nativeStatic OFF) lane is the ORACLE — A2's future
		// gate reads "promoted routes are byte-identical to the JS lane", so the JS
		// lane is the reference and promotion (ON) is the candidate under test.
		id: 'native-static-off-vs-on@listen',
		oracle: nativeStaticOff,
		candidate: nativeStaticOn,
		requiresTag: 'safe-for-socket'
	},
	{
		id: 'jit-vs-aot-reconstruct@handle',
		oracle: jitHandle,
		candidate: aotReconstructHandle
	}
]
