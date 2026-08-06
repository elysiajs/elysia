import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled, type ProgramId } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	resetCompactErrorWarnings
} from '../../src/compile/aot-capture'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'

import { claimManifest, materialise } from './_manifest'

/**
 * Cookie and query object/array fields compile to
 * `Union([decoded, encodedString])` carrying `~elyTyp` ObjectString or
 * ArrayString. The sealed walker has no TypeBox to fall back on, so without a
 * look-through it can only report "must match Union" for the whole field —
 * while the wired lane names the offending leaf. These tests pin the sealed
 * lane to the wired lane's `errors[0]` so a sealed deploy keeps telling a
 * client *which* field of the decoded JSON is wrong.
 *
 * Parity is asserted on `errors[0]` / `payload.property` / `payload.detail`,
 * NOT on `.all`: for a union the wired lane emits three entries (both branch
 * failures plus the `anyOf` summary) where the sealed lane emits one, so the
 * arrays cannot match by construction.
 *
 * Two rows diverge by design, each asserted below rather than papered over:
 *   1. a still-encoded string — the sealed lane parses it and so reports more
 *      than the wired lane can
 *   2. an explicit `undefined` at the codec field — the sealed lane skips it to
 *      avoid masking a failing sibling
 */

const PATH = '/x'

/** Seal one slot, then hand back both lanes built over the same schema. */
function lanes(slot: 'cookie' | 'query' | 'body', schema: any) {
	const method = slot === 'body' ? 'POST' : 'GET'
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCompactErrorWarnings()

	// the coarse-detail warning is asserted in frozen-error-detail.test.ts
	const original = console.warn
	console.warn = () => {}

	let claimed: { ['~programId']: ProgramId }

	try {
		beginValidatorCapture()
		const app =
			slot === 'body'
				? new Elysia().post(PATH, { body: schema }, () => 'ok')
				: new Elysia().get(
						PATH,
						{ [slot]: schema } as any,
						() => 'ok'
					)
		;(app as any).compile()
		const captured = endValidatorCapture()
		endHandlerCapture()

		Compiled.clear()
		Validator.clear()
		claimed = claimManifest({ validators: materialise(captured) })
	} finally {
		console.warn = original
		delete process.env.ELYSIA_AOT_BUILD
	}

	const hook = { [slot]: schema } as any

	const wired = new RouteValidator(hook, {
		aot: { method, path: PATH },
		app: claimed
	} as any)
	const sealed = buildFrozenRouteValidator(hook, claimed as any, method, PATH)

	expect(
		(sealed as any)?.[slot],
		`${slot} slot should seal bridge-free`
	).toBeDefined()

	return { wired: (wired as any)[slot], sealed: (sealed as any)[slot] }
}

function validationError(validator: any, value: unknown, slot: string) {
	try {
		validator.From(structuredClone(value), slot)
	} catch (error) {
		return error as any
	}

	throw new Error('expected the invalid value to be rejected')
}

const arona = t.Cookie({
	challenge: t.Optional(
		t.Object({
			nonce: t.String(),
			ip: t.String(),
			issued: t.Number(),
			bits: t.Number()
		})
	)
})

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('sealed JSON-string codec errors name the decoded field', () => {
	// A real request never reaches the validator holding the raw string: the
	// cookie and query parsers JSON-decode `{...}`/`[...]` first, so this is
	// the shape production traffic actually produces.
	it('matches the wired lane on a decoded object with a bad field', () => {
		const { wired, sealed } = lanes('cookie', arona)
		const value = {
			challenge: { nonce: 'a', ip: 'b', issued: 1, bits: 'nan' }
		}

		const w = validationError(wired, value, 'cookie')
		const f = validationError(sealed, value, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'type',
			schemaPath: '#/properties/challenge/anyOf/0/properties/bits',
			instancePath: '/challenge/bits',
			params: { type: 'number' },
			message: 'must be number'
		})
		expect(JSON.stringify(f.errors[0])).toBe(JSON.stringify(w.errors[0]))
		expect(f.payload.property).toBe(w.payload.property)
		expect(f.payload.property).toBe('/challenge/bits')
		expect(f.payload.detail).toBe(w.payload.detail)
	})

	it('matches the wired lane on a missing required decoded field', () => {
		const { wired, sealed } = lanes('cookie', arona)
		const value = { challenge: { nonce: 'a', ip: 'b', issued: 1 } }

		const w = validationError(wired, value, 'cookie')
		const f = validationError(sealed, value, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'required',
			schemaPath: '#/properties/challenge/anyOf/0',
			instancePath: '/challenge',
			params: { requiredProperties: ['bits'] },
			message: 'must have required properties bits'
		})
		expect(JSON.stringify(f.errors[0])).toBe(JSON.stringify(w.errors[0]))
		expect(f.payload.property).toBe(w.payload.property)
		expect(f.payload.detail).toBe('must have required properties bits')
	})

	it('lists every missing required decoded field in one error', () => {
		// TypeBox reports the whole missing set at once; a walker that stopped
		// at the first key would send a client round-tripping one fix at a time
		const { wired, sealed } = lanes('cookie', arona)
		const value = { challenge: { nonce: 'a', ip: 'b' } }

		const w = validationError(wired, value, 'cookie')
		const f = validationError(sealed, value, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'required',
			schemaPath: '#/properties/challenge/anyOf/0',
			instancePath: '/challenge',
			params: { requiredProperties: ['issued', 'bits'] },
			message: 'must have required properties issued, bits'
		})
		expect(JSON.stringify(f.errors[0])).toBe(JSON.stringify(w.errors[0]))
	})

	it('decodes a still-encoded string to name the field', () => {
		const { wired, sealed } = lanes('cookie', arona)
		const value = {
			challenge: '{"nonce":"a","ip":"b","issued":1,"bits":"nan"}'
		}

		const f = validationError(sealed, value, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'type',
			schemaPath: '#/properties/challenge/anyOf/0/properties/bits',
			instancePath: '/challenge/bits',
			params: { type: 'number' },
			message: 'must be number'
		})

		// No parity assertion here on purpose: TypeBox tests the decoded branch
		// against the raw string, so the wired lane can only say "must be
		// object". The sealed lane parses first and so reports strictly more.
		// This row is reachable over real HTTP: the cookie and query parsers
		// only JSON-decode values that *start* with `{`/`[`, so a payload with
		// so much as a leading space arrives at the validator still encoded.
		const w = validationError(wired, value, 'cookie')
		expect(w.errors[0].message).toBe('must be object')
		expect(w.errors[0].instancePath).toBe('/challenge')
	})

	it('leaves a malformed JSON string on the coarse error', () => {
		const { wired, sealed } = lanes('cookie', arona)
		const value = { challenge: '{not json' }

		const f = validationError(sealed, value, 'cookie')
		const w = validationError(wired, value, 'cookie')

		// unparseable input carries no field to point at, so both lanes keep
		// exactly the message they produced before the look-through existed
		expect(f.errors[0]).toEqual({
			keyword: 'type',
			schemaPath: '#/properties/challenge',
			instancePath: '/challenge',
			params: {},
			message: 'must match Union'
		})
		expect(w.errors[0].message).toBe('must be object')
	})

	it('leaves a constraint-only failure on the coarse error', () => {
		// the walker only knows types, required keys, and array recursion, so a
		// violated `minLength` must fall through rather than invent a hit
		const { sealed } = lanes(
			'cookie',
			t.Cookie({
				challenge: t.Optional(
					t.Object({ nonce: t.String({ minLength: 5 }) })
				)
			})
		)

		const f = validationError(sealed, { challenge: { nonce: 'ab' } }, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'type',
			schemaPath: '#/properties/challenge',
			instancePath: '/challenge',
			params: {},
			message: 'must match Union'
		})
	})

	// The look-through's value guard decides which values are worth decoding.
	// Both halves matter and neither is covered by the rows above: skipping too
	// much reports the wrong property, skipping too little masks a sibling.
	describe('the value guard', () => {
		const mixed = t.Object({
			meta: t.ObjectString({ a: t.String() }),
			token: t.Number()
		})

		it('skips an explicit undefined so a failing sibling still wins', () => {
			const { sealed } = lanes('body', mixed)

			const f = validationError(
				sealed,
				{ meta: undefined, token: 'bad' },
				'body'
			)

			// a false `/meta must be object` here would hide the real failure
			expect(f.errors[0].instancePath).toBe('/token')
			expect(f.errors[0].message).toBe('must be number')
		})

		it('still reports the codec field itself when it is null', () => {
			const { wired, sealed } = lanes('body', mixed)
			const value = { meta: null, token: 1 }

			const w = validationError(wired, value, 'body')
			const f = validationError(sealed, value, 'body')

			expect(f.errors[0]).toEqual({
				keyword: 'type',
				schemaPath: '#/properties/meta/anyOf/0',
				instancePath: '/meta',
				params: { type: 'object' },
				message: 'must be object'
			})
			expect(JSON.stringify(f.errors[0])).toBe(JSON.stringify(w.errors[0]))
		})
	})

	it('matches the wired lane on an ArrayString element', () => {
		const { wired, sealed } = lanes(
			'cookie',
			t.Cookie({ ids: t.Array(t.String()) })
		)
		const value = { ids: ['a', 1] }

		const w = validationError(wired, value, 'cookie')
		const f = validationError(sealed, value, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'type',
			schemaPath: '#/properties/ids/anyOf/0/items',
			instancePath: '/ids/1',
			params: { type: 'string' },
			message: 'must be string'
		})
		expect(JSON.stringify(f.errors[0])).toBe(JSON.stringify(w.errors[0]))
		expect(f.payload.property).toBe(w.payload.property)
		expect(f.payload.property).toBe('/ids/1')
	})

	it('recurses through a union nested inside a union', () => {
		// an explicit `t.ArrayString` inside a cookie slot gets wrapped by the
		// slot's own coercion union, so the look-through has to fire twice —
		// note the doubled `anyOf/0` in the schema path
		const { wired, sealed } = lanes(
			'cookie',
			t.Cookie({ ids: t.ArrayString(t.String()) })
		)
		const value = { ids: ['a', 1] }

		const w = validationError(wired, value, 'cookie')
		const f = validationError(sealed, value, 'cookie')

		expect(f.errors[0]).toEqual({
			keyword: 'type',
			schemaPath: '#/properties/ids/anyOf/0/anyOf/0/items',
			instancePath: '/ids/1',
			params: { type: 'string' },
			message: 'must be string'
		})
		expect(JSON.stringify(f.errors[0])).toBe(JSON.stringify(w.errors[0]))
	})
})

/** Seal one slot and hand back only the `[elysia-aot]` warnings it produced. */
function buildWarnings(slot: 'cookie' | 'query', schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	process.env.ELYSIA_AOT_VERBOSE = '1'
	resetCompactErrorWarnings()

	const warns: string[] = []
	const original = console.warn
	console.warn = (...args: unknown[]) => warns.push(args.join(' '))

	try {
		beginValidatorCapture()
		const app = new Elysia().get(
			PATH,
			{ [slot]: schema } as any,
			() => 'ok'
		)
		;(app as any).compile()
		endValidatorCapture()
		endHandlerCapture()
	} finally {
		console.warn = original
		delete process.env.ELYSIA_AOT_BUILD
		delete process.env.ELYSIA_AOT_VERBOSE
	}

	Compiled.clear()
	Validator.clear()

	return warns.filter((w) => w.includes('[elysia-aot]'))
}

/**
 * The build warns that a sealed slot will lose error detail. A slot whose only
 * codec is a JSON-string union no longer loses any, so warning about it would
 * train maintainers to ignore the one warning that still means something.
 */
describe('the coarse-detail build warning', () => {
	it('stays silent for a slot whose only codec is an ObjectString', () => {
		expect(buildWarnings('cookie', arona)).toEqual([])
	})

	it('stays silent for a union nested inside a union', () => {
		expect(
			buildWarnings('cookie', t.Cookie({ ids: t.ArrayString(t.String()) }))
		).toEqual([])
	})

	it('still fires for a scalar coercion the walker cannot see past', () => {
		// t.Numeric is a coercion union with no decoded object branch to walk
		expect(buildWarnings('query', t.Object({ n: t.Numeric() })).length).toBe(
			1
		)
	})

	it('still fires when a scalar coercion sits beside an ObjectString', () => {
		const warns = buildWarnings(
			'cookie',
			t.Cookie({
				challenge: t.Optional(
					t.Object({ nonce: t.String(), bits: t.Number() })
				),
				n: t.Numeric()
			})
		)

		expect(warns.length).toBe(1)
		expect(warns[0]).toContain('cookie')
	})

	it('still fires when the decoded side is not walkable', () => {
		// the JSON parses fine, but `t.Date` inside it is a codec of its own
		expect(
			buildWarnings(
				'cookie',
				t.Cookie({ challenge: t.Optional(t.Object({ when: t.Date() })) })
			).length
		).toBe(1)
	})
})

describe('end to end codec error detail', () => {
	/**
	 * This drives the WIRED lane: `Reconstrct.validator` only takes the sealed
	 * branch when `isBridgeLive()` is false, and importing `t` wires the bridge
	 * for the whole process (see test/compile/reconstruct-bridge-free.test.ts).
	 * A genuinely sealed `handle()` needs the subprocess/esbuild-bundle fixture
	 * pattern; the sealed lane is covered above at the validator level instead.
	 */
	it('reports the decoded field for a real Cookie header', async () => {
		const app = new Elysia().get('/', { cookie: arona }, () => 'ok')

		const challenge = JSON.stringify({
			nonce: 'a',
			ip: 'b',
			issued: 1,
			bits: 'nan'
		})

		const response = await app.handle(
			new Request('http://localhost/', {
				headers: {
					cookie: `challenge=${encodeURIComponent(challenge)}`
				}
			})
		)

		expect(response.status).toBe(422)

		const body = (await response.json()) as any
		expect(body.property).toBe('/challenge/bits')
		expect(body.detail).toBe('must be number')
	})
})
