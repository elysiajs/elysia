import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { detachValidatorCompiler, Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	resetCompactErrorWarnings
} from '../../src/compile/aot-capture'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'

import { claimManifest, materialise, type ClaimedManifest } from './_manifest'

// Sealed and wired validators expose the same field-specific errors.

const METHOD = 'POST'
const PATH = '/x'

function freeze(schema: any): { warns: string[] } {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCompactErrorWarnings()

	const warns: string[] = []
	const original = console.warn
	console.warn = (...args: unknown[]) => warns.push(args.join(' '))

	try {
		beginValidatorCapture()
		const app = new Elysia().post(
			PATH,
			{ body: schema },
			({ body }) => body
		)
		;(app as any).compile()
		const captured = endValidatorCapture()

		Compiled.clear()
		Validator.clear()
		claimed = claimManifest({ validators: materialise(captured) })
	} finally {
		console.warn = original
		delete process.env.ELYSIA_AOT_BUILD
	}

	return { warns }
}

// program claimed by the latest `freeze()`
let claimed: ClaimedManifest

const hook = (schema: any) => ({ body: schema })
const root = () => claimed as any

const wired = (schema: any) =>
	new RouteValidator(
		hook(schema) as any,
		{
			aot: { method: METHOD, path: PATH },
			app: claimed,
			frozenSlots: claimed.validators[METHOD]![PATH]!
		} as any
	)

const bridgeFree = (schema: any) =>
	buildFrozenRouteValidator(
		hook(schema) as any,
		root(),
		METHOD,
		PATH,
		claimed.validators[METHOD]![PATH]!
	)

function validationError(validator: any, value: unknown): any {
	try {
		validator.From(structuredClone(value), 'body')
	} catch (error) {
		return error
	}
	throw new Error('expected the invalid value to be rejected')
}

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('sealed validation errors identify offending fields', () => {
	const cases: [string, any, unknown][] = [
		[
			'missing required property',
			t.Object({ name: t.String(), age: t.Number() }),
			{ age: 5 }
		],
		[
			'top-level property type mismatch',
			t.Object({ name: t.String(), age: t.Number() }),
			{ name: 'a', age: 'x' }
		],
		[
			'nested property type mismatch',
			t.Object({ user: t.Object({ name: t.String() }) }),
			{ user: { name: 5 } }
		],
		[
			'nested missing required property',
			t.Object({ user: t.Object({ name: t.String() }) }),
			{ user: {} }
		],
		[
			'array element type mismatch',
			t.Object({ xs: t.Array(t.Number()) }),
			{ xs: ['a'] }
		]
	]

	for (const [name, schema, input] of cases)
		it(name, () => {
			freeze(schema)

			const w = wired(schema)
			const f = bridgeFree(schema)
			expect(f, 'schema should be sealed bridge-free').toBeDefined()

			const wErr = validationError(w.body, input)
			const fErr = validationError(f!.body, input)

			expect(
				fErr.all.length,
				'sealed error list must not be empty'
			).toBeGreaterThan(0)
			expect(JSON.stringify(fErr.all)).toBe(JSON.stringify(wErr.all))
			expect(fErr.payload.property).toBe(wErr.payload.property)
		})

	it('reports the missing required property', () => {
		const schema = t.Object({ name: t.String(), age: t.Number() })
		freeze(schema)

		const fErr = validationError(bridgeFree(schema)!.body, { age: 5 })

		expect(fErr.all.length).toBeGreaterThan(0)
		expect(fErr.all[0].message).toBe('must have required properties name')
	})
})

describe('sealed codec errors remain visible', () => {
	it('t.Date slot warns at build time and names the field best-effort', () => {
		const schema = t.Object({ when: t.Date() })
		const { warns } = freeze(schema)

		const aotWarns = warns.filter((w) => w.includes('[elysia-aot]'))
		expect(aotWarns.length).toBe(1)
		expect(aotWarns[0]).toContain('POST /x')
		expect(aotWarns[0]).toContain('body')
		expect(aotWarns[0]).toContain('best-effort')

		const fErr = validationError(bridgeFree(schema)!.body, {
			when: 'garbage'
		})

		expect(fErr.all.length).toBeGreaterThan(0)
		expect(fErr.payload.property).toBe('/when')
		expect(fErr.payload.property).not.toBe('root')
	})

	it('t.Numeric slot warns and rejects with a non-empty error', () => {
		const schema = t.Object({ n: t.Numeric() })
		const { warns } = freeze(schema)

		expect(warns.filter((w) => w.includes('[elysia-aot]')).length).toBe(1)

		const fErr = validationError(bridgeFree(schema)!.body, { n: 'abc' })
		expect(fErr.all.length).toBeGreaterThan(0)
		expect(fErr.payload.property).toBe('/n')
	})

	it('warns once per slot within a build', () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		resetCompactErrorWarnings()

		const warns: string[] = []
		const original = console.warn
		console.warn = (...args: unknown[]) => warns.push(args.join(' '))

		try {
			beginValidatorCapture()
			const app = new Elysia().post(
				PATH,
				{ body: t.Object({ a: t.Date(), b: t.Numeric() }) },
				({ body }) => body
			)
			expect(() => (app as any).compile()).not.toThrow()
			endValidatorCapture()
		} finally {
			console.warn = original
			delete process.env.ELYSIA_AOT_BUILD
		}

		expect(warns.filter((w) => w.includes('[elysia-aot]')).length).toBe(1)
	})
})

describe('sealed structural schemas retain full error details', () => {
	it('plain object/scalar/array schema seals without any warning', () => {
		const { warns } = freeze(
			t.Object({
				name: t.String(),
				age: t.Number(),
				tags: t.Array(t.String())
			})
		)

		expect(warns.filter((w) => w.includes('[elysia-aot]')).length).toBe(0)
	})

	it('drops diagnostics in strict production and keeps them for introspection', () => {
		const schema = t.Object({ age: t.Number() })

		freeze(schema)
		const strict = bridgeFree(schema)!
		detachValidatorCompiler(claimed, false)
		expect((strict.body as any).schema).toBeUndefined()
		expect(
			validationError(strict.body, { age: 'x' }).errors[0].instancePath
		).toBe('/age')

		freeze(schema)
		const introspect = bridgeFree(schema)!
		detachValidatorCompiler(claimed, true)
		expect((introspect.body as any).schema).toBeUndefined()
		expect(
			validationError(introspect.body, { age: 'x' }).errors[0]
				.instancePath
		).toBe('/age')
	})
})
