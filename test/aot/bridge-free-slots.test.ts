import { describe, it, expect, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { Compiled, type CapturedValidator } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { claimManifest, materialise } from './_manifest'

/** Slot coercion without TypeBox must match the wired validator exactly. */

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

function capture(slot: Slot, schema: any, method: string, path: string) {
	process.env.ELYSIA_AOT_BUILD = '1'
	beginValidatorCapture()

	const app = new Elysia()[method.toLowerCase() as 'get'](
		path,
		{ [slot]: schema } as any,
		(ctx: any) => ctx[slot]
	)
	;(app as any).compile()

	const captured = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD

	return captured.filter((c) => c.slot === slot)
}

function wiredResults(
	slot: Slot,
	schema: any,
	captured: CapturedValidator[],
	method: string,
	path: string,
	cases: unknown[]
) {
	Compiled.clear()
	const claimed = claimManifest({ validators: materialise(captured) })
	const frozenSlots = claimed.validators[method]![path]!

	const validator = new RouteValidator(
		{ [slot]: schema } as any,
		{
			aot: { method, path },
			app: claimed,
			frozenSlots
		} as any
	)

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
	expect(captured[0]!.bridgeFree, `${name}: bridgeFree marker`).toBe(true)

	const wired = wiredResults(slot, schema, captured, method, path, cases)

	const file = writePayload({ captured, spec, cases, method, path, slot })
	const { proc, parsed } = runChild(file)

	expect(proc.status, proc.stderr).toBe(0)
	expect(parsed.BRIDGE, `${name}: bridge state`).toBe('unwired')

	const result = parsed.RESULT as {
		reconstructed: boolean
		results: Array<{ ok: boolean; value?: unknown; status?: number }>
	}

	expect(result.reconstructed, `${name}: reconstructed`).toBe(true)
	// Normalize the in-process reference through the child's JSON boundary.
	const wireWired = JSON.parse(JSON.stringify(wired))
	expect(result.results, name).toEqual(wireWired)
}

// Compare values in-process where Date and negative zero retain their identity.
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
	const claimed = claimManifest({ validators: materialise(captured) })
	const frozenSlots = claimed.validators[method]![path]!

	const wired = new RouteValidator(
		{ [slot]: schema } as any,
		{
			aot: { method, path },
			app: claimed,
			frozenSlots
		} as any
	) as any
	const frozen = buildFrozenRouteValidator(
		{ [slot]: schema } as any,
		{ ...claimed, '~config': {}, '~ext': {} } as any,
		method as any,
		path,
		frozenSlots
	)

	expect(
		frozen && (frozen as any)[slot],
		`${name}: reconstructed`
	).toBeTruthy()

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

		expect(
			fThrew,
			`${name}: throw parity for ${JSON.stringify(value)}`
		).toBe(wThrew)
		expect(f, `${name}: value parity for ${JSON.stringify(value)}`).toEqual(
			w
		)
	}

	Compiled.clear()
}

describe('slot coercion without TypeBox', () => {
	it('coerces numeric, boolean, and string query values', () => {
		assertParity(
			'query mixed',
			'query',
			{ n: { t: 'numeric' }, b: { t: 'boolean' }, s: { t: 'string' } },
			[
				{ n: '1', b: 'true', s: 'x' },
				{ n: '3.14', b: 'false', s: '' },
				{ n: '-0', b: 'true', s: 'a' },
				{ n: '+1', b: 'true', s: 'a' },
				{ n: '1e2', b: 'true', s: 'a' },
				{ n: 'Infinity', b: 'true', s: 'a' },
				{ n: 'NaN', b: 'true', s: 'a' },
				{ n: '', b: 'true', s: 'a' },
				{ n: '  1  ', b: 'true', s: 'a' },
				{ n: '1', b: 'yes', s: 'a' },
				{ n: '1', b: 'true' },
				{ n: '1', b: 'true', s: 'a', extra: 'z' }
			]
		)
	})

	it('accepts integer query strings and rejects non-integers', () => {
		assertParity('query integer', 'query', { i: { t: 'integer' } }, [
			{ i: '42' },
			{ i: '-7' },
			{ i: '3.14' },
			{ i: '1e2' },
			{ i: '' },
			{ i: 'abc' }
		])
	})

	it('decodes valid date query strings and rejects invalid dates', () => {
		assertParity('query date', 'query', { d: { t: 'date' } }, [
			{ d: '2024-01-02T03:04:05.000Z' },
			{ d: '2024-01-02' },
			{ d: 'not-a-date' },
			{ d: '' }
		])
	})

	it('handles absent, valid, and invalid optional query values', () => {
		assertParity(
			'query optional',
			'query',
			{ n: { t: 'numeric', optional: true }, s: { t: 'string' } },
			[{ s: 'x' }, { n: '5', s: 'x' }, { n: 'bad', s: 'x' }]
		)
	})

	it('coerces numeric headers', () => {
		assertParity(
			'headers numeric',
			'headers',
			{ 'x-count': { t: 'numeric' } },
			[{ 'x-count': '10' }, { 'x-count': 'nope' }]
		)
	})

	it('coerces numeric route parameters', () => {
		assertParity(
			'params numeric',
			'params',
			{ id: { t: 'numeric' } },
			[{ id: '99' }, { id: 'x' }],
			'GET',
			'/user/:id'
		)
	})

	it('coerces numeric cookies', () => {
		assertParity(
			'cookie numeric',
			'cookie',
			{ session: { t: 'integer' } },
			[{ session: '123' }, { session: '1.5' }]
		)
	})

	it('rejects repeated query values for a scalar schema', () => {
		assertParity('query repeated-key', 'query', { n: { t: 'numeric' } }, [
			{ n: '1' },
			{ n: ['1', '2'] }
		])
	})
})

describe('exact values from slot coercion', () => {
	it('matches wired values for mixed query coercion', () => {
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

	it('returns Date instances for date query values', () => {
		const schema = t.Object({ d: t.Date() })
		const captured = capture('query', schema, 'GET', '/d')

		Compiled.clear()
		const claimed = claimManifest({ validators: materialise(captured) })
		const frozenSlots = claimed.validators.GET!['/d']!

		const wired = new RouteValidator(
			{ query: schema } as any,
			{
				aot: { method: 'GET', path: '/d' },
				app: claimed,
				frozenSlots
			} as any
		) as any
		const frozen = buildFrozenRouteValidator(
			{ query: schema } as any,
			{ ...claimed, '~config': {}, '~ext': {} } as any,
			'GET' as any,
			'/d',
			frozenSlots
		) as any

		const input = { d: '2024-01-02T03:04:05.000Z' }
		const w = wired.query.From({ ...input }, 'query')
		const f = frozen.query.From({ ...input }, 'query')

		expect(w.d instanceof Date).toBe(true)
		expect(f.d instanceof Date).toBe(true)
		expect((f.d as Date).getTime()).toBe((w.d as Date).getTime())

		Compiled.clear()
	})

	it('preserves negative zero', () => {
		const schema = t.Object({ n: t.Numeric() })
		const captured = capture('query', schema, 'GET', '/z')

		Compiled.clear()
		const claimed = claimManifest({ validators: materialise(captured) })
		const frozenSlots = claimed.validators.GET!['/z']!

		const wired = new RouteValidator(
			{ query: schema } as any,
			{
				aot: { method: 'GET', path: '/z' },
				app: claimed,
				frozenSlots
			} as any
		) as any
		const frozen = buildFrozenRouteValidator(
			{ query: schema } as any,
			{ ...claimed, '~config': {}, '~ext': {} } as any,
			'GET' as any,
			'/z',
			frozenSlots
		) as any

		const w = wired.query.From({ n: '-0' }, 'query')
		const f = frozen.query.From({ n: '-0' }, 'query')

		expect(Object.is(f.n, w.n)).toBe(true)
		expect(Object.is(w.n, -0)).toBe(true)

		Compiled.clear()
	})
})
