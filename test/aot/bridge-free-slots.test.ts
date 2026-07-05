import { describe, it, expect, afterEach, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	resetCaptureLifecycleForTests,
	type CapturedValidator
} from '../../src/compile/aot'
import { materialise } from './_manifest'

/**
 * Parity battery for the SLOT-LEVEL scalar-coercion bridge-free path.
 *
 * WHY this test exists (intent): the bridge-free frozen validator was extended to
 * cover query/headers/params/cookie objects whose leaves are the standard scalar
 * coercion codecs the user wrote explicitly (`t.Numeric()`, `t.IntegerString()`,
 * `t.BooleanString()`, `t.Date()`, and `t.Optional(...)` of those). Wire values
 * arrive as STRINGS, so those slots must DECODE (string→typed) before check/Clean
 * — the piece that previously forced the wired TypeBox bridge. This test pins that
 * the bridge-free reconstruction is byte-identical to the wired path, including
 * the coercion edge cases (scientific notation, empty/blank strings, NaN, invalid
 * booleans, excess-key stripping) AND that it runs with the bridge NEVER wired.
 *
 * Two arms per scenario:
 *   - WIRED reference: computed IN-PROCESS via a real `RouteValidator` (bridge is
 *     wired here — that is the ground truth).
 *   - BRIDGE-FREE: computed in a CHILD process that imports only the reconstruct
 *     machinery + the PURE coercion constructors (never the type barrel), so the
 *     bridge is genuinely severed. Results must match the wired arm exactly.
 */

const CHILD = resolve(import.meta.dir, 'fixtures/bridge-free-slots-child.ts')

type Slot = 'query' | 'headers' | 'params' | 'cookie'
type LeafSpec = {
	t: 'numeric' | 'integer' | 'boolean' | 'date' | 'string'
	optional?: boolean
}

let dir: string | undefined

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
	if (dir) {
		rmSync(dir, { recursive: true, force: true })
		dir = undefined
	}
})

// Map a leaf spec to the barrel constructor the PARENT captures against. The
// child rebuilds the identical shape from the pure constructors (see the child
// fixture) — behaviourally identical closures, which is all the reconstruct path
// needs at runtime.
const barrelLeaf = (leaf: LeafSpec) => {
	const base =
		leaf.t === 'numeric'
			? t.Numeric()
			: leaf.t === 'integer'
				? t.IntegerString()
				: leaf.t === 'boolean'
					? t.BooleanString()
					: leaf.t === 'date'
						? t.Date()
						: t.String()
	return leaf.optional ? t.Optional(base) : base
}

const buildSchema = (spec: Record<string, LeafSpec>) => {
	const properties: Record<string, unknown> = {}
	for (const key in spec) properties[key] = barrelLeaf(spec[key]!)
	return t.Object(properties)
}

// Capture a slot manifest for `schema` (bridge IS wired here — capture needs the
// live TypeBox; the CHILD runs unwired).
function capture(slot: Slot, schema: any, method: string, path: string) {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCaptureLifecycleForTests()
	beginValidatorCapture()

	const app = new Elysia()[method.toLowerCase() as 'get'](
		path,
		{ [slot]: schema } as any,
		(ctx: any) => ctx[slot]
	)
	;(app as any).compile()

	const captured = endValidatorCapture()
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	return captured.filter((c) => c.slot === slot)
}

// The in-process WIRED reference: materialise the manifest, build the real
// RouteValidator (bridge wired), run each case. This is the ground truth.
function wiredResults(
	slot: Slot,
	schema: any,
	captured: CapturedValidator[],
	method: string,
	path: string,
	cases: unknown[]
) {
	Compiled.clear()
	Compiled.validators = materialise(captured)

	const validator = new RouteValidator({ [slot]: schema } as any, {
		aot: { method, path }
	} as any)

	const slotValidator = (validator as any)[slot]
	const results = cases.map((value) => {
		try {
			return { ok: true, value: slotValidator.From(value, slot) }
		} catch (error: any) {
			return { ok: false, status: error?.status ?? 500 }
		}
	})

	Compiled.clear()
	return results
}

function writePayload(data: unknown) {
	dir = mkdtempSync(join(tmpdir(), 'ely-bridge-free-slots-'))
	const file = join(dir, 'payload.json')
	writeFileSync(file, JSON.stringify(data))
	return file
}

function runChild(payloadFile: string) {
	const proc = spawnSync('bun', [CHILD], {
		env: {
			...process.env,
			PAYLOAD: payloadFile,
			ELYSIA_AOT_BUILD: ''
		},
		encoding: 'utf8'
	})

	const lines = (proc.stdout ?? '').trim().split('\n').filter(Boolean)
	const parsed: Record<string, unknown> = {}
	for (const line of lines) {
		const sp = line.indexOf(' ')
		if (sp === -1) continue
		try {
			parsed[line.slice(0, sp)] = JSON.parse(line.slice(sp + 1))
		} catch {}
	}

	return { proc, parsed }
}

// Full battery for one scenario: assert the slot is marked bridge-free at
// capture, then assert the CHILD (unwired) results are byte-identical to the
// in-process WIRED reference.
function assertParity(
	name: string,
	slot: Slot,
	spec: Record<string, LeafSpec>,
	cases: unknown[],
	method = 'GET',
	path = '/x'
) {
	const schema = buildSchema(spec)
	const captured = capture(slot, schema, method, path)

	expect(captured.length, `${name}: captured a slot entry`).toBe(1)
	// the marker is the seal gate — every scenario here MUST be bridge-free
	expect(captured[0]!.bridgeFree, `${name}: bridgeFree marker`).toBe(true)

	const wired = wiredResults(slot, schema, captured, method, path, cases)

	const file = writePayload({ captured, spec, cases, method, path, slot })
	const { proc, parsed } = runChild(file)

	expect(proc.status, proc.stderr).toBe(0)
	// scenario proven: the bridge was genuinely unwired in the child
	expect(parsed.BRIDGE, `${name}: bridge state`).toBe('unwired')

	const result = parsed.RESULT as {
		reconstructed: boolean
		results: Array<{ ok: boolean; value?: unknown; status?: number }>
	}

	expect(result.reconstructed, `${name}: reconstructed`).toBe(true)
	// The child necessarily returns results across the process boundary as JSON
	// (its stdout). Compare on that WIRE representation — normalize the in-process
	// wired reference through the identical JSON round-trip so a `Date` object vs
	// its ISO string, or `-0` vs `0`, are compared as they serialize on the wire
	// (JSON.stringify collapses both). Key ORDER is preserved by JSON.stringify, so
	// this still pins the coerced object's key order. The EXACT (non-JSON) value
	// identity — real `Date`, `-0` — is pinned by the in-process arm below.
	const wireWired = JSON.parse(JSON.stringify(wired))
	expect(result.results, name).toEqual(wireWired)
}

// In-process exact-identity arm: build the bridge-free validator and the wired
// validator in the SAME process and compare their `.From` outputs WITHOUT a JSON
// round-trip, so genuine value divergence (`Date` object vs string, `-0` vs `0`,
// NaN) would be caught. This complements the subprocess arm (which proves the
// unwired scenario but can only observe the JSON wire form).
function assertExactParity(
	name: string,
	slot: Slot,
	spec: Record<string, LeafSpec>,
	cases: unknown[],
	method = 'GET',
	path = '/x'
) {
	const schema = buildSchema(spec)
	const captured = capture(slot, schema, method, path)

	Compiled.clear()
	Compiled.validators = materialise(captured)

	const wired = new RouteValidator({ [slot]: schema } as any, {
		aot: { method, path }
	} as any) as any
	const frozen = buildFrozenRouteValidator(
		{ [slot]: schema } as any,
		{ '~config': {}, '~ext': {} } as any,
		method as any,
		path
	)

	expect(frozen && (frozen as any)[slot], `${name}: reconstructed`).toBeTruthy()

	for (const value of cases) {
		let w: any
		let wThrew = false
		try {
			w = wired[slot].From(structuredClone(value), slot)
		} catch (e: any) {
			wThrew = true
			w = e?.status ?? 500
		}

		let f: any
		let fThrew = false
		try {
			f = (frozen as any)[slot].From(structuredClone(value), slot)
		} catch (e: any) {
			fThrew = true
			f = e?.status ?? 500
		}

		expect(fThrew, `${name}: throw parity for ${JSON.stringify(value)}`).toBe(
			wThrew
		)
		// deep-equal exact values (bun toEqual distinguishes Date instances and,
		// for the -0 case, we additionally Object.is the numeric leaf below)
		expect(f, `${name}: value parity for ${JSON.stringify(value)}`).toEqual(w)
	}

	Compiled.clear()
}

describe('bridge-free slot coercion (subprocess, unwired bridge)', () => {
	it('query: Numeric + BooleanString + plain String — full edge battery', () => {
		assertParity(
			'query mixed',
			'query',
			{ n: { t: 'numeric' }, b: { t: 'boolean' }, s: { t: 'string' } },
			[
				{ n: '1', b: 'true', s: 'x' }, // accept + coerce
				{ n: '3.14', b: 'false', s: '' }, // decimal + empty string ok
				{ n: '-0', b: 'true', s: 'a' }, // signed zero
				{ n: '+1', b: 'true', s: 'a' }, // leading plus
				{ n: '1e2', b: 'true', s: 'a' }, // scientific → reject (422)
				{ n: 'Infinity', b: 'true', s: 'a' }, // reject
				{ n: 'NaN', b: 'true', s: 'a' }, // reject
				{ n: '', b: 'true', s: 'a' }, // empty numeric → reject
				{ n: '  1  ', b: 'true', s: 'a' }, // padded → reject
				{ n: '1', b: 'yes', s: 'a' }, // invalid boolean → reject
				{ n: '1', b: 'true' }, // missing required s → reject
				{ n: '1', b: 'true', s: 'a', extra: 'z' } // excess key → stripped
			]
		)
	})

	it('query: IntegerString rejects decimals, accepts integer strings', () => {
		assertParity(
			'query integer',
			'query',
			{ i: { t: 'integer' } },
			[
				{ i: '42' }, // accept
				{ i: '-7' }, // accept
				{ i: '3.14' }, // decimal → reject
				{ i: '1e2' }, // scientific → reject
				{ i: '' }, // empty → reject
				{ i: 'abc' } // non-numeric → reject
			]
		)
	})

	it('query: t.Date coerces ISO strings, rejects garbage', () => {
		assertParity(
			'query date',
			'query',
			{ d: { t: 'date' } },
			[
				{ d: '2024-01-02T03:04:05.000Z' }, // accept
				{ d: '2024-01-02' }, // accept (date-only)
				{ d: 'not-a-date' }, // reject
				{ d: '' } // reject
			]
		)
	})

	it('query: t.Optional(t.Numeric()) — absent, present, invalid', () => {
		assertParity(
			'query optional',
			'query',
			{ n: { t: 'numeric', optional: true }, s: { t: 'string' } },
			[
				{ s: 'x' }, // n absent → ok
				{ n: '5', s: 'x' }, // n present → coerce
				{ n: 'bad', s: 'x' } // n invalid → reject
			]
		)
	})

	it('headers: Numeric coercion (case-insensitive keys via lowercased input)', () => {
		assertParity(
			'headers numeric',
			'headers',
			{ 'x-count': { t: 'numeric' } },
			[
				{ 'x-count': '10' }, // accept + coerce
				{ 'x-count': 'nope' } // reject
			]
		)
	})

	it('params: Numeric coercion', () => {
		assertParity(
			'params numeric',
			'params',
			{ id: { t: 'numeric' } },
			[{ id: '99' }, { id: 'x' }],
			'GET',
			'/user/:id'
		)
	})

	it('cookie: Numeric coercion', () => {
		assertParity(
			'cookie numeric',
			'cookie',
			{ session: { t: 'integer' } },
			[{ session: '123' }, { session: '1.5' }]
		)
	})

	it('query: repeated-key shape (array value) stays parity with wired', () => {
		// A repeated query key parses to an array before validation; a scalar
		// coercion schema rejects the array — assert both paths agree.
		assertParity(
			'query repeated-key',
			'query',
			{ n: { t: 'numeric' } },
			[
				{ n: '1' }, // scalar → coerce
				{ n: ['1', '2'] } // array → reject (scalar schema)
			]
		)
	})
})

describe('bridge-free slot coercion (in-process exact identity)', () => {
	// These pin the EXACT decoded value (real `Date` instances, `-0`) that the
	// subprocess arm's JSON wire form cannot observe.
	it('Numeric/BooleanString mixed — exact values equal the wired path', () => {
		assertExactParity(
			'exact query mixed',
			'query',
			{ n: { t: 'numeric' }, b: { t: 'boolean' }, s: { t: 'string' } },
			[
				{ n: '1', b: 'true', s: 'x' },
				{ n: '3.14', b: 'false', s: '' },
				{ n: '+1', b: 'true', s: 'a' },
				{ n: '1e2', b: 'true', s: 'a' },
				{ n: '1', b: 'yes', s: 'a' },
				{ n: '1', b: 'true', s: 'a', extra: 'z' }
			]
		)
	})

	it('t.Date — decoded value is a real Date instance in BOTH paths', () => {
		const schema = t.Object({ d: t.Date() })
		const captured = capture('query', schema, 'GET', '/d')

		Compiled.clear()
		Compiled.validators = materialise(captured)

		const wired = new RouteValidator({ query: schema } as any, {
			aot: { method: 'GET', path: '/d' }
		} as any) as any
		const frozen = buildFrozenRouteValidator(
			{ query: schema } as any,
			{ '~config': {}, '~ext': {} } as any,
			'GET' as any,
			'/d'
		) as any

		const input = { d: '2024-01-02T03:04:05.000Z' }
		const w = wired.query.From({ ...input }, 'query')
		const f = frozen.query.From({ ...input }, 'query')

		expect(w.d instanceof Date).toBe(true)
		expect(f.d instanceof Date).toBe(true)
		expect((f.d as Date).getTime()).toBe((w.d as Date).getTime())

		Compiled.clear()
	})

	it('negative zero survives coercion identically in BOTH paths', () => {
		const schema = t.Object({ n: t.Numeric() })
		const captured = capture('query', schema, 'GET', '/z')

		Compiled.clear()
		Compiled.validators = materialise(captured)

		const wired = new RouteValidator({ query: schema } as any, {
			aot: { method: 'GET', path: '/z' }
		} as any) as any
		const frozen = buildFrozenRouteValidator(
			{ query: schema } as any,
			{ '~config': {}, '~ext': {} } as any,
			'GET' as any,
			'/z'
		) as any

		const w = wired.query.From({ n: '-0' }, 'query')
		const f = frozen.query.From({ n: '-0' }, 'query')

		// Object.is distinguishes -0 from 0 — both paths must agree exactly
		expect(Object.is(f.n, w.n)).toBe(true)
		expect(Object.is(w.n, -0)).toBe(true)

		Compiled.clear()
	})
})

/**
 * Promotion e2e: a query/params-coercion-only app now gates to `sealed` (mode A)
 * — before slot-coercion coverage it was `wired` (mode B). The sealed bundle must
 * drop the TypeBox value/compile engine and still validate + coerce at runtime.
 *
 * Like the sibling mode-gating / bridge-free-strip tests, this only manifests
 * through the PUBLISHED module graph: the plugin (loaded by path from `dist`) must
 * share the `Compiled` instance the fixture's bare `elysia` import resolves to.
 * The standard gate builds `dist` first.
 */
describe('bridge-free slot coercion — sealed promotion e2e', () => {
	const APP = resolve(import.meta.dir, 'fixtures/bridge-free-slots-app.ts')
	const dragsTypeBox = (source: string): boolean =>
		/typebox\/(value|compile)/.test(source)

	let esbuildBundle: string | undefined
	let mode: string | undefined
	let tmp: string | undefined
	let appPath: string | undefined

	// Build everything, then STOP esbuild BEFORE any dynamic import (with the
	// esbuild service alive, importing a freshly-written .mjs in-process spuriously
	// fails "Cannot find module" — see mode-gating.test.ts header).
	async function setup() {
		if (esbuildBundle !== undefined) return

		const distCore = (await import(
			resolve(import.meta.dir, '../../dist/plugin/core.mjs')
		)) as typeof import('../../src/plugin/core')

		mode = (await distCore.generateCompiledArtifacts(APP, { strip: true }))
			.mode

		const esbuild = await import('esbuild')
		const { aot } = (await import(
			resolve(import.meta.dir, '../../dist/plugin/esbuild.mjs')
		)) as typeof import('../../src/plugin/esbuild')

		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			const result = await esbuild.build({
				entryPoints: [APP],
				bundle: true,
				write: false,
				format: 'esm',
				platform: 'neutral',
				minify: true,
				external: ['node:*'],
				logLevel: 'silent',
				plugins: [aot(APP)]
			})
			esbuildBundle = result.outputFiles[0]!.text
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}

		await esbuild.stop()

		tmp = mkdtempSync(join(tmpdir(), 'ely-slots-sealed-'))
		appPath = join(tmp, 'sealed.mjs')
		writeFileSync(appPath, esbuildBundle)
	}

	afterAll(() => {
		if (tmp) {
			rmSync(tmp, { recursive: true, force: true })
			tmp = undefined
		}
	})

	it('gates a query/params-coercion app to sealed (was wired)', async () => {
		await setup()
		expect(mode).toBe('sealed')
	})

	it('the sealed bundle drops TypeBox value/compile and setupTypebox', async () => {
		await setup()
		expect(dragsTypeBox(esbuildBundle!)).toBe(false)
		expect(/setupTypebox\(\)/.test(esbuildBundle!)).toBe(false)

		const min = Buffer.byteLength(esbuildBundle!)
		const gz = gzipSync(esbuildBundle!, { level: 9 }).length
		// well below the wired ~275K — a TypeBox regression would blow past this
		expect(min).toBeLessThan(160_000)
		expect(gz).toBeLessThan(50_000)
	})

	it('the sealed bundle still coerces and fail-closes at runtime', async () => {
		await setup()

		const mod = (await import(appPath!)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default

		// valid: strings coerce to number/boolean
		const ok = await app.handle(
			new Request('http://localhost/search?n=1&b=true&s=x')
		)
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ n: 1, b: true, s: 'x' })

		// invalid coercion → 422 (fail-closed even with TypeBox severed)
		const bad = await app.handle(
			new Request('http://localhost/search?n=abc&b=true&s=x')
		)
		expect(bad.status).toBe(422)

		// params coercion path
		const param = await app.handle(new Request('http://localhost/user/42'))
		expect(param.status).toBe(200)
		await expect(param.json()).resolves.toEqual({ id: 42 })
	})
})
