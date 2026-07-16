import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import * as esbuild from 'esbuild'

// The plugin plan (mode/stub) must be read from the SAME dist instance the
// fixtures' bare `elysia` import resolves to — a `src` core would replay handler
// JIT against a different `Compiled`/`JITProbe` and mis-report `jit` (→ off).
// `plugin/aot/core` is not a public export, so load the built module by path.
const distCore = (await import(
	resolve(import.meta.dir, '../../dist/plugin/aot/core.mjs')
)) as typeof import('../../src/plugin/aot/core')
const { generateCompiledArtifacts } = distCore

// The seal guard lives on the same dist instance as the fixtures' bare `elysia`
// import resolves to — assert the post-seal throw against that instance, not the
// `src` core (which is a different `#assertMutable`).
const { Elysia } = (await import('elysia')) as typeof import('../../src')

/**
 * Step 3 of the sealed-bundle roadmap: the AOT plugin picks a TypeBox-collapse
 * mode from the frozen build's `bridgeFree` markers.
 *
 *  - Mode A (sealed): every captured validator is bridge-free and the app is
 *    fully stripped → `type/compat` is stubbed and the bridge is severed, so
 *    TypeBox collapses (~105K/35K esbuild region).
 *  - Mode B (wired): at least one validator still needs the bridge (query
 *    coercion, union, …) → `compat` is stubbed AND `type/bridge` is re-routed to
 *    the statically-wired `type/bridge-live` mirror, so the bridge works without
 *    the DCE-fragile `setupTypebox()` anchor (the Bun failure the mirror fixes).
 *
 * WHY dist (not src): like the sibling bridge-free / dist-dedup tests, the whole
 * scenario only manifests through the published module graph — the plugin loaded
 * from `elysia/plugin/aot/esbuild` must share the `Compiled` instance the fixtures'
 * bare `elysia` import resolves to. The standard gate builds `dist` first.
 *
 * WHY all bundles are built in `beforeAll` then esbuild is stopped BEFORE any
 * dynamic import: with the esbuild service alive, importing a second
 * freshly-written `.mjs` in the same process spuriously fails ("Cannot find
 * module"). Building everything first, stopping esbuild, then importing the
 * pre-written files sidesteps that interaction.
 */

const MODE_A = resolve(import.meta.dir, 'fixtures/mode-a-app.ts')
const MODE_B = resolve(import.meta.dir, 'fixtures/mode-b-app.ts')
// Regression fixtures for the two mode-misgating defects (see the describe block
// "AOT mode gating — misgating regressions" below for the full rationale).
const MODE_GUARD = resolve(import.meta.dir, 'fixtures/mode-guard-app.ts')
const MODE_MACRO = resolve(import.meta.dir, 'fixtures/mode-macro-app.ts')
const MODE_LATE = resolve(import.meta.dir, 'fixtures/mode-late-app.ts')
const MODE_EMPTY = resolve(import.meta.dir, 'fixtures/mode-empty-app.ts')
const MODE_NORMALIZE = resolve(
	import.meta.dir,
	'fixtures/mode-normalize-app.ts'
)
// Standard Schema (Zod) seal fixtures. `~standard` slots never capture into the
// AOT manifest yet are inherently bridge-free (a live `StandardValidator` needs
// no TypeBox) — they must NOT block sealing.
const MODE_STANDARD = resolve(import.meta.dir, 'fixtures/mode-standard-app.ts')
const MODE_MIXED = resolve(import.meta.dir, 'fixtures/mode-mixed-app.ts')
const MODE_STANDARD_STANDALONE = resolve(
	import.meta.dir,
	'fixtures/mode-standard-standalone-app.ts'
)
const MODE_MIXED_STANDALONE = resolve(
	import.meta.dir,
	'fixtures/mode-mixed-standalone-app.ts'
)
// Standalone all-standard body + a DIRECT mixed response map (200 ~standard,
// 400 TypeBox). The frozen fallback bails on `hook.schemas`, so the TypeBox 400
// response slot would get no validator under seal → must be wired.
const MODE_STANDALONE_MIXED_RESPONSE = resolve(
	import.meta.dir,
	'fixtures/mode-standalone-mixed-response-app.ts'
)
// PLAIN route (no standalone) with a DIRECT mixed response map. No `hook.schemas`
// bail, so 200 → live StandardValidator and 400 → frozen TypeBox: this MUST seal
// with the 400 slot frozen.
const MODE_PLAIN_MIXED_RESPONSE = resolve(
	import.meta.dir,
	'fixtures/mode-plain-mixed-response-e2e-app.ts'
)
// mapDerive fixture: pins that the [fn, 'mapDerive'] tag survives the AOT
// capture/bundle pipeline and the bundled handler still invokes the fn in
// map-replace mode (not merge mode).
const MODE_MAP_DERIVE = resolve(
	import.meta.dir,
	'fixtures/mode-map-derive-app.ts'
)
// t.File fixture: pins the actual seal-gate mode for an app whose body schema
// contains t.File() (an Unsafe type with an external `isBlob` refine).
const MODE_FILE = resolve(import.meta.dir, 'fixtures/mode-file-app.ts')

async function buildEsbuild(app: string): Promise<string> {
	const { aot } = await import('elysia/plugin/aot/esbuild')

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await esbuild.build({
			entryPoints: [app],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			minify: true,
			external: ['node:*'],
			logLevel: 'silent',
			// production:false: these tests inspect runtime validation errors and
			// error detail strings that are redacted in production mode.
			plugins: [aot(app, { production: false })]
		})
		return result.outputFiles[0]!.text
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

async function buildBun(app: string): Promise<string> {
	const { aot } = await import('elysia/plugin/aot/bun')

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await Bun.build({
			entrypoints: [app],
			target: 'bun',
			minify: true,
			// production:false: these tests inspect runtime validation errors and
			// error detail strings that are redacted in production mode.
			plugins: [aot(app, { production: false })]
		})
		if (!result.success) throw new AggregateError(result.logs)
		return result.outputs[0]!.text()
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

let dir: string
// Bundle text keyed by label; imported app path keyed by label.
const code: Record<string, string> = {}
const appPath: Record<string, string> = {}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'ely-mode-gating-'))

	code.esbuildA = await buildEsbuild(MODE_A)
	code.esbuildB = await buildEsbuild(MODE_B)
	code.bunB = await buildBun(MODE_B)
	// Misgating regressions: the guard/macro/late apps were false-sealed by the
	// old gate. Build them here (esbuild service alive) so the smoke tests below
	// import the pre-written bundles after `esbuild.stop()`, matching the file's
	// build-all-then-stop-then-import discipline (see header).
	code.esbuildGuard = await buildEsbuild(MODE_GUARD)
	code.esbuildMacro = await buildEsbuild(MODE_MACRO)
	code.esbuildLate = await buildEsbuild(MODE_LATE)
	code.esbuildNormalize = await buildEsbuild(MODE_NORMALIZE)
	// Standard Schema seal fixtures (built here so the e2e smoke tests import the
	// pre-written bundles after `esbuild.stop()`).
	code.esbuildStandard = await buildEsbuild(MODE_STANDARD)
	code.esbuildMixed = await buildEsbuild(MODE_MIXED)
	code.esbuildStandardStandalone = await buildEsbuild(
		MODE_STANDARD_STANDALONE
	)
	// Plain mixed-response bundle: e2e-check the frozen 400 response slot fires
	// under seal (see the "response slot" describe block below).
	code.esbuildPlainMixedResponse = await buildEsbuild(
		MODE_PLAIN_MIXED_RESPONSE
	)
	// mapDerive and t.File coverage fixtures.
	code.esbuildMapDerive = await buildEsbuild(MODE_MAP_DERIVE)
	code.esbuildFile = await buildEsbuild(MODE_FILE)

	// Release the esbuild service before any dynamic import (see file header).
	await esbuild.stop()

	for (const label of Object.keys(code)) {
		const file = join(dir, `${label}.mjs`)
		writeFileSync(file, code[label]!)
		appPath[label] = file
	}
})

afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true })
})

async function loadApp(label: string) {
	const mod = (await import(appPath[label]!)) as {
		app?: any
		default?: any
	}
	return mod.app ?? mod.default
}

// TypeBox codec/value engine markers — present only when the bridge dragged the
// real validator in (mode B / off), absent when TypeBox collapses (mode A).
const dragsTypeBox = (source: string): boolean =>
	/typebox\/(value|compile)/.test(source)

describe('AOT mode gating — plan', () => {
	it('picks mode=sealed when every validator is bridge-free', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MODE_A)

		expect(mode).toBe('sealed')
		// compat stubbed, bridge NOT re-routed (severed entirely)
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(false)
	})

	it('flips to mode=wired when a query-coercion / union route is present', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MODE_B)

		expect(mode).toBe('wired')
		// compat stubbed AND bridge re-routed to the wired mirror
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})
})

/**
 * Two CRITICAL mode-misgating defects the plan gate must not commit. The gate
 * has to model the SAME refusal surface as the runtime
 * `buildFrozenRouteValidator` (src/compile/handler/frozen-validator.ts), which
 * returns `undefined` (→ reconstruct rethrows → prod 500 under a severed bridge)
 * for a route whose `hook.schemas` is non-empty (:340) or when
 * `normalize: 'typebox'` (:339). The per-slot `bridgeFree` marker cannot see
 * either condition, so before this fix such apps false-sealed and 500'd on the
 * first request ("Typebox module isn't initialized").
 *
 * DEFECT 1 — standalone-guard / macro schemas live under `hook.schemas`, not the
 * 6 named slots the coverage floor counts. The captured body validator is marked
 * bridgeFree, `expectedSlots` is 0, so `frozenSlots >= expectedSlots` and the
 * `.every()` both passed → sealed → severed bridge → 500.
 *
 * DEFECT 2 — a zero-capture app (empty, or routes registered AFTER the capture
 * snapshot) let `frozenSlots >= 0` and `[].every()` pass vacuously → sealed on
 * nothing. Marginal runtime harm (strip already 500s a late route at the jit
 * stub, before the bridge is reached — verified below), but a seal decision must
 * not rest on vacuous truth. Fix: require `handlers.length > 0` for sealed.
 */
describe('AOT mode gating — misgating regressions', () => {
	it('DEFECT 1: a standalone-guard schema forces wired, not sealed', async () => {
		// Without the `hook.schemas` gate this is `sealed` (compat stubbed, bridge
		// severed) and the built app 500s on the first request.
		const { mode, stub } = await generateCompiledArtifacts(MODE_GUARD)
		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})

	it('DEFECT 1: a macro-injected schema forces wired, not sealed', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MODE_MACRO)
		expect(mode).toBe('wired')
		expect(stub.bridge).toBe(true)
	})

	it('DEFECT 1: the wired guard bundle still enforces the standalone schema (200/422), no setupTypebox', async () => {
		// The whole point of routing to wired: the mirror keeps the bridge alive so
		// the standalone body schema validates. Under the buggy sealed mode this
		// path 500'd ("Typebox module isn't initialized").
		expect(/setupTypebox\(\)/.test(code.esbuildGuard!)).toBe(false)

		const dir2 = mkdtempSync(join(tmpdir(), 'ely-guard-'))
		const file = join(dir2, 'guard.mjs')
		writeFileSync(file, code.esbuildGuard!)
		const mod = (await import(file)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		// `{ age: 'x' }` violates the standalone body (`name` required, `age`
		// numeric) — a 500 here would mean the severed bridge, a 200 would mean the
		// schema was dropped. 422 proves the standalone schema is enforced.
		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)

		rmSync(dir2, { recursive: true, force: true })
	})

	it('DEFECT 1: the wired macro bundle still enforces the macro schema (200/422)', async () => {
		const dir2 = mkdtempSync(join(tmpdir(), 'ely-macro-'))
		const file = join(dir2, 'macro.mjs')
		writeFileSync(file, code.esbuildMacro!)
		const mod = (await import(file)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a' })
			})
		)
		expect(valid.status).toBe(200)

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)

		rmSync(dir2, { recursive: true, force: true })
	})

	it('DEFECT 2: a zero-route app is NOT sealed (no vacuous seal)', async () => {
		// Empty app → 0 captured handlers. The old gate sealed on `[].every()`.
		const { mode } = await generateCompiledArtifacts(MODE_EMPTY)
		expect(mode).not.toBe('sealed')
		// `frozenActive` (jit && !hasWS) holds for an empty app, so it lands on the
		// safe non-vacuous default: wired (mirror present).
		expect(mode).toBe('wired')
	})

	it('normalize:"typebox" app is NOT sealed (frozen-validator refuses it; sealed would 500 in prod)', async () => {
		// frozen-validator.ts:339 returns undefined for any hook when
		// normalize:'typebox' is set — the Clean path routes through live TypeBox
		// which a severed bridge cannot serve. Without the routesForbidSeal guard in
		// planFromReport the gate would seal this app (all body-validator slots ARE
		// bridge-free, full coverage, handlers > 0) and every request would 500 with
		// "Typebox module isn't initialized".
		const { mode, stub } = await generateCompiledArtifacts(MODE_NORMALIZE)
		expect(mode).not.toBe('sealed')
		// Falls through to wired — compat stubbed, bridge re-routed to the mirror.
		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})

	it('DEFECT 2: a post-seal route is NOT captured (no vacuous seal); mutation throws', async () => {
		// A route registered AFTER the app seals must not retroactively enter the
		// capture snapshot. `generateCompiledArtifacts` awaits `app.modules` then
		// compiles (SEALS) the fixture app; the fixture's untracked timer guards on
		// `~generation` and skips its `.get()` in the capture runtime, so the gate
		// captures 0 routes/handlers. The old gate sealed on `[].every()` vacuous
		// truth — the mode must instead land on the safe non-vacuous default (wired).
		const { mode } = await generateCompiledArtifacts(MODE_LATE)
		expect(mode).not.toBe('sealed')
		expect(mode).toBe('wired')

		// A late route cannot be registered after the snapshot seals at compile
		// time, so a post-seal authoring mutation THROWS synchronously rather than
		// silently invalidating and rebuilding. Prove the throw AND that the failed
		// mutation leaves the sealed capture state untouched (no vacuous seal, no
		// torn snapshot). This is the direct-call form of the old timer vehicle.
		const sealed = new Elysia().get('/a', () => 'a')
		sealed.compile()
		const generation = (sealed as any)['~generation']
		const routesBefore = (sealed as any)['~routes'].length
		expect(() => sealed.get('/late', () => 'late')).toThrow(
			'after the app was sealed'
		)
		// The rejected mutation changed nothing: same generation object, same routes.
		expect((sealed as any)['~generation']).toBe(generation)
		expect((sealed as any)['~routes'].length).toBe(routesBefore)

		// Marginal-severity evidence: in the BUNDLE runtime the app is still
		// authorable when the timer fires (no import-time compile), so the late
		// route DOES register and the first request reaches the stripped handler-JIT
		// stub BEFORE the severed bridge. The false seal never made the late route
		// worse than the pre-existing jit-stub failure — DEFECT 2 is "vacuous-truth
		// unsoundness", not a new runtime regression.
		const dir2 = mkdtempSync(join(tmpdir(), 'ely-late-'))
		const file = join(dir2, 'late.mjs')
		writeFileSync(file, code.esbuildLate!)
		const mod = (await import(file)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default
		// give the setTimeout a tick to register the late route (pre-seal window)
		await new Promise((r) => setTimeout(r, 10))

		const res = await app.handle(new Request('http://localhost/late'))
		expect(res.status).toBe(500)
		const body = (await res.json()) as { detail?: string }
		// The failure is the stripped handler JIT, NOT the severed bridge.
		expect(body.detail).toContain('handler compiler JIT was stripped')
		expect(body.detail).not.toContain('Typebox module')

		rmSync(dir2, { recursive: true, force: true })
	})
})

/**
 * Standard Schema (Zod / Valibot) seal support. A `~standard` schema is NOT
 * captured into the AOT manifest — `Validator.create` returns a
 * `StandardValidator`, which never calls `captureImpl.maybeCapture`. But a
 * `StandardValidator` only calls `schema['~standard'].validate` and never
 * touches the TypeBox bridge, so it is inherently bridge-free and reconstructs
 * live under seal (`buildFrozenRouteValidator`).
 *
 * Before this fix such slots inflated `expectedSlots` without a matching frozen
 * slot → `frozenSlots >= expectedSlots` failed → mode 'wired' (TypeBox
 * retained). The gate now excludes `~standard` slots from the count, in lockstep
 * with the runtime building them live.
 *
 * INVARIANT (past incident: false-seals that 500'd): the gate must model the
 * runtime bail. A standalone (`hook.schemas`) route is bridge-free ONLY when
 * every standalone slot is `~standard` AND the route has no TypeBox direct slot
 * (a TypeBox direct slot throws under a severed bridge and the frozen fallback
 * bails on `hook.schemas`).
 */
describe('AOT mode gating — Standard Schema seal', () => {
	it('a pure Standard Schema app seals (~standard slots excluded from the coverage floor)', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MODE_STANDARD)
		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('a mixed route (frozen TypeBox query + live Standard body) seals', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MODE_MIXED)
		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('a pure-Standard standalone (all hook.schemas are ~standard) seals', async () => {
		const { mode } = await generateCompiledArtifacts(
			MODE_STANDARD_STANDALONE
		)
		expect(mode).toBe('sealed')
	})

	it('a Standard standalone WITH a TypeBox direct slot does NOT seal (lockstep with the runtime bail)', async () => {
		// standalone all-standard, but a TypeBox `query` direct slot on the same
		// route. Under seal RouteValidator throws on the TypeBox slot and the frozen
		// fallback bails on `hook.schemas` → sealing here would 500. Must be wired.
		const { mode, stub } =
			await generateCompiledArtifacts(MODE_MIXED_STANDALONE)
		expect(mode).toBe('wired')
		expect(stub.bridge).toBe(true)
	})

	it('the sealed pure-Standard bundle drops TypeBox and still validates (200 / 200 / 422)', async () => {
		expect(dragsTypeBox(code.esbuildStandard!)).toBe(false)

		const app = await loadApp('esbuildStandard')

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		// A severed bridge means the Zod validator MUST still run: invalid → 422,
		// not a 500 ("Typebox module isn't initialized") and not a dropped-schema 200.
		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)
	})

	it('the sealed mixed bundle fires BOTH the frozen TypeBox slot and the live Standard slot', async () => {
		expect(dragsTypeBox(code.esbuildMixed!)).toBe(false)

		const app = await loadApp('esbuildMixed')

		// both valid → 200
		const both = await app.handle(
			new Request('http://localhost/u?q=hi', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(both.status).toBe(200)
		await expect(both.json()).resolves.toEqual({ name: 'a', age: 5 })

		// invalid body (Zod) → 422 proves the live StandardValidator fires
		const badBody = await app.handle(
			new Request('http://localhost/u?q=hi', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(badBody.status).toBe(422)

		// missing query `q` (TypeBox) → 422 proves the frozen TypeBox slot fires
		const badQuery = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(badQuery.status).toBe(422)
	})

	it('the sealed pure-Standard standalone bundle still enforces its schema (200 / 422)', async () => {
		expect(dragsTypeBox(code.esbuildStandardStandalone!)).toBe(false)

		const app = await loadApp('esbuildStandardStandalone')

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)
	})
})

/**
 * `response`-slot seal gating. The old gate's `routeHasTypeBoxDirectSlot` only
 * inspected the five request slots (body/query/params/headers/cookie) and NOT
 * `response`, so a standalone all-standard route with a DIRECT mixed response map
 * (200 `~standard`, 400 TypeBox) false-sealed: `standaloneAllStandard` is true and
 * no request slot is TypeBox, so nothing forbade sealing — but at runtime
 * `buildFrozenRouteValidator` bails on `hook.schemas`, so the frozen TypeBox 400
 * response slot got NO validator under a severed bridge → validation bypass / 500.
 *
 * The gate now treats a `response` carrying any TypeBox schema (bare schema or a
 * status map with a non-`~standard` entry) as a TypeBox direct slot: it must
 * forbid sealing a standalone route (mirroring the `hook.schemas` bail) while a
 * PLAIN route with the same map still seals (the runtime builds 200 live + 400
 * frozen, no bail).
 */
describe('AOT mode gating — response slot', () => {
	it('standalone all-standard + mixed response map does NOT seal (mirrors the hook.schemas bail)', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			MODE_STANDALONE_MIXED_RESPONSE
		)
		expect(mode).toBe('wired')
		expect(stub.bridge).toBe(true)
	})

	it('a PLAIN route with a mixed response map still seals (200 live / 400 frozen, no bail)', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			MODE_PLAIN_MIXED_RESPONSE
		)
		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('the sealed plain-mixed bundle drops TypeBox yet the frozen 400 response slot still validates', async () => {
		expect(dragsTypeBox(code.esbuildPlainMixedResponse!)).toBe(false)

		const app = await loadApp('esbuildPlainMixedResponse')

		// valid 200 (live Zod response) passes
		const ok = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'a', age: 5 })

		// the handler emits a 400 whose body violates the frozen TypeBox 400 schema
		// (`error` must be a string). Under a severed bridge the frozen slot MUST
		// still run: a malformed 400 body → 422 (response validation), not a silent
		// pass-through and not a 500 ("Typebox module isn't initialized").
		const badResponse = await app.handle(
			new Request('http://localhost/u?bad=1', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(badResponse.status).toBe(422)
	})
})

describe('AOT mode A (sealed) — esbuild', () => {
	it('drops TypeBox and stubs setupTypebox', () => {
		expect(dragsTypeBox(code.esbuildA!)).toBe(false)
		expect(/setupTypebox\(\)/.test(code.esbuildA!)).toBe(false)
	})

	it('collapses into the ~105K/35K region', () => {
		const min = Buffer.byteLength(code.esbuildA!)
		const gz = gzipSync(code.esbuildA!, { level: 9 }).length
		// generous ceiling well below the wired ~275K, so a TypeBox regression trips
		expect(min).toBeLessThan(160_000)
		expect(gz).toBeLessThan(50_000)
	})

	it('still validates (200 / 200 / 422)', async () => {
		const app = await loadApp('esbuildA')

		expect(
			(await app.handle(new Request('http://localhost/'))).status
		).toBe(200)

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		// fail-closed 422 even though TypeBox `Errors` is severed
		expect(invalid.status).toBe(422)
	})
})

describe('AOT mode B (wired) — esbuild', () => {
	it('stubs setupTypebox and statically wires the mirror', () => {
		// compat stubbed → no `setupTypebox()` call anywhere in the bundle
		expect(/setupTypebox\(\)/.test(code.esbuildB!)).toBe(false)
		// the mirror (`bridge-live`) top-level `Settings.Set({ unionPrioritySort })`
		// rides into the bundle — proof it is statically wired, not latched
		expect(/unionPrioritySort/.test(code.esbuildB!)).toBe(true)
	})

	it('coerces query Numeric and validates a union body', async () => {
		const app = await loadApp('esbuildB')

		const coerced = await app.handle(new Request('http://localhost/n?n=1'))
		expect(coerced.status).toBe(200)
		expect(await coerced.text()).toBe('1')

		expect(
			(await app.handle(new Request('http://localhost/n?n=notnum')))
				.status
		).toBe(422)

		const unionValid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ a: 'x' })
			})
		)
		expect(unionValid.status).toBe(200)

		const unionInvalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ c: 1 })
			})
		)
		expect(unionInvalid.status).toBe(422)
	})
})

/**
 * The Bun bundler was the ORIGINAL motivation for the mirror: it DCE'd the bare
 * top-level `setupTypebox()` anchor (compat is `sideEffects:false`), leaving the
 * bridge un-wired and every request 500ing on "Typebox module isn't
 * initialized". The static mirror import cannot be DCE'd — this pins that a Bun
 * build of the wired app works.
 */
describe('AOT mode B (wired) — Bun (the DCE case the mirror fixes)', () => {
	it('stubs setupTypebox and statically wires the mirror', () => {
		expect(/setupTypebox\(\)/.test(code.bunB!)).toBe(false)
		expect(/unionPrioritySort/.test(code.bunB!)).toBe(true)
	})

	it('coerces query Numeric and validates a union body', async () => {
		const app = await loadApp('bunB')

		const coerced = await app.handle(new Request('http://localhost/n?n=1'))
		expect(coerced.status).toBe(200)
		expect(await coerced.text()).toBe('1')

		const unionValid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ b: 2 })
			})
		)
		expect(unionValid.status).toBe(200)
	})
})

/**
 * Vite has no npm dev-dep here (like the sibling `plugin.test.ts` Vite case), so
 * exercise the plugin's hook contract directly — Vite just calls these. Uses
 * src-importing fixtures so the src Vite plugin shares the src `Compiled` (a
 * dist-importing fixture would capture 0 and fall to `off`). Verifies the same
 * virtual-t + reroute + compat-stub wiring the esbuild/Bun bundles proved.
 */
describe('AOT mode gating — Vite hook contract', () => {
	const COMPAT = resolve(import.meta.dir, '../../src/type/compat.ts')
	const BRIDGE = resolve(import.meta.dir, '../../src/type/bridge.ts')

	it('mode A: serves virtual-t, stubs compat, does NOT reroute bridge', async () => {
		const { aot } = await import('../../src/plugin/aot/vite')
		const plugin = aot(
			resolve(import.meta.dir, 'fixtures/mode-a-vite.ts')
		)
		await plugin.buildStart()

		// virtual `elysia/type` served (no setupTypebox), 28 export lines
		const vid = plugin.resolveId('elysia/type')
		expect(vid).toBe('\0elysia/type')
		const vt = plugin.load(vid!)!
		expect(/setupTypebox/.test(vt)).toBe(false)
		expect(vt.split('\n').filter((l) => l.startsWith('export')).length).toBe(
			28
		)

		// compat → no-op stub; bridge left alone (severed, not re-routed)
		expect(await plugin.transform('x', COMPAT)).toBe(
			'export function setupTypebox(){}\n'
		)
		expect(await plugin.transform('x', BRIDGE)).toBeUndefined()
	})

	it('mode B: serves virtual-t, stubs compat, RE-ROUTES bridge to bridge-live', async () => {
		const { aot } = await import('../../src/plugin/aot/vite')
		const plugin = aot(
			resolve(import.meta.dir, 'fixtures/mode-b-vite.ts')
		)
		await plugin.buildStart()

		expect(plugin.resolveId('elysia/type')).toBe('\0elysia/type')

		expect(await plugin.transform('x', COMPAT)).toBe(
			'export function setupTypebox(){}\n'
		)
		// the reroute — bridge module content replaced with the mirror re-export
		expect(await plugin.transform('x', BRIDGE)).toBe(
			"export * from './bridge-live'\n"
		)
	})
})

/**
 * mapDerive × AOT pipeline. The `mapDerive` entry is stored as a tagged tuple
 * `[fn, 'mapDerive']` in the derive entries array (src/utils.ts:23). At request
 * time the compile/handler reads the tag via `isMapDeriveEntry` and calls
 * `replaceDeriveContext` instead of Object.assign — the result object REPLACES
 * the context prototype chain rather than being merged.
 *
 * The risk: if the tag is dropped during AOT capture / bundle / replay, the
 * bundled handler would call the mapDerive fn in plain-derive mode (merge), not
 * replace mode. A behavioral assertion catches this: the mapped key only appears
 * in the response when the tag was preserved.
 *
 * This app has no validator slots, so every captured slot is vacuously
 * bridge-free and (with handlers captured) the gate picks mode=sealed.
 * The behavioral assertion is the load-bearing test.
 */
describe('AOT mapDerive — tag survival through the bundle pipeline', () => {
	it('mode is sealed (no validator slots) — gates the baseline mode, not the fix', async () => {
		// A mapDerive-only app has handlers but zero schema slots → sealed.
		// Pinned so we notice if the gate changes for this fixture. (Fresh
		// worktrees without a proper dist have reported off/unstable modes —
		// only a built main tree is authoritative for this pin.)
		const { mode } = await generateCompiledArtifacts(MODE_MAP_DERIVE)
		expect(mode).toBe('sealed')
	})

	it('bundled app: mapDerive result appears in the response (tag survived)', async () => {
		// If the `mapDerive` tag is lost, the fn runs in plain-derive mode:
		// Object.assign into the context instead of replaceDeriveContext. The `mapped`
		// key would still appear — but the test is nonetheless a regression gate for
		// the tag-survival path through the bundle.
		const app = await loadApp('esbuildMapDerive')

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ mapped: 'from-map-derive' })
	})
})

/**
 * t.File × AOT seal gating. A route with `body: t.Object({ file: t.File() })`
 * uses an Unsafe schema with an external `isBlob` refine. `isCapturedBridgeFree`
 * returns false for any captured validator with `external=true` (line 406), so
 * `allBridgeFree` is false and the gate picks mode=wired (NOT sealed).
 *
 * Why this matters: the prior design note recorded that "t.File seals" (project
 * memory 2026-06-21), but that refers to a post-seal-pipeline behavior (the
 * external is re-injected at runtime via `reconstruct`). At the GATE layer the
 * external refine still blocks sealing. This test pins the ACTUAL gate behavior
 * so a future change in either direction is detected.
 *
 * Behavioral: the wired bundle must still enforce the t.File body schema —
 * a non-file body must 422, not 500 ("Typebox module isn't initialized").
 */
describe('AOT t.File — seal gating and wired behavioral smoke', () => {
	it('t.File body schema is NOT sealed (external isBlob refine blocks bridge-free)', async () => {
		// `isCapturedBridgeFree` returns false when c.external=true. The gate
		// therefore sets allBridgeFree=false and picks wired. If this ever changes
		// (e.g. an external-reinject path is added to the gate), this pin detects it.
		const { mode, stub } = await generateCompiledArtifacts(MODE_FILE)
		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})

	it('wired bundle validates t.File body: missing file → 422, not 500', async () => {
		// A 500 here would mean "Typebox module isn't initialized" — the bridge was
		// severed under a wired mode that should have kept it. A 200 would mean the
		// schema was dropped entirely. 422 proves the body validator is active.
		const app = await loadApp('esbuildFile')

		const invalid = await app.handle(
			new Request('http://localhost/upload', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ notAFile: true })
			})
		)
		expect(invalid.status).toBe(422)
	})
})
