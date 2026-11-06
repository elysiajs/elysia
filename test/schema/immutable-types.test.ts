import '../../src/compile/aot-capture'
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn
} from 'bun:test'
import { System } from 'typebox/system'
import * as z from 'zod'

import { Elysia, form as elysiaForm, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { mutableTypes } from '../../src/type/typebox-type'
import { Validator } from '../../src/validator'
import { buildMode, claimManifest, materialise } from '../aot/_manifest'
import typeboxPackage from '../../node_modules/typebox/package.json'

// TypeBox >= 1.4 `immutableTypes` deep-freezes what every builder is given and
// returns; Elysia builds its own nodes (model module, merged guards, JSON
// string coercion) and must keep writing to them. 1.3 only freezes the node
// shallowly, so this pin only has teeth on a 1.4 install
//
// Side effect: the last describe ('shared bases') runs t.Date({ ... }) and
// t.File({ ... }) under immutableTypes, which deep-freezes the module-level
// t.Date / t.File bases for the rest of the process (bun test runs every file
// in one process, and those bases have no reset). Every later t.Date() /
// t.File() hands out a frozen base, as it would in an app with immutableTypes
const even = (value: string) => value.length % 2 === 0
const Even = () => t.Refine(t.String(), even, () => 'must be even')

const json = (body: unknown) =>
	new Request('http://localhost/', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

const query = (value: unknown) =>
	new Request(
		`http://localhost/?o=${encodeURIComponent(
			typeof value === 'string' ? value : JSON.stringify(value)
		)}`
	)

const form = (meta: unknown) => {
	const body = new FormData()
	body.append('meta', JSON.stringify(meta))

	return new Request('http://localhost/', { method: 'POST', body })
}

const expectValidates = async (
	app: { handle(request: Request): Promise<Response> },
	valid: Request,
	invalid: Request
) => {
	const ok = await app.handle(valid)
	expect(`${ok.status} ${ok.status === 200 ? '' : await ok.text()}`).toBe(
		'200 '
	)
	expect((await app.handle(invalid)).status).toBe(422)
}

// Elysia's bracket around its own builders: the user's setting must survive it
describe('mutableTypes', () => {
	const previous = System.Settings.Get().immutableTypes
	afterEach(() => System.Settings.Set({ immutableTypes: previous }))

	it('builds with immutableTypes off and restores it', () => {
		System.Settings.Set({ immutableTypes: true })

		expect(mutableTypes(() => System.Settings.Get().immutableTypes)).toBe(
			false
		)
		expect(System.Settings.Get().immutableTypes).toBe(true)
	})

	it('restores immutableTypes when the build throws', () => {
		System.Settings.Set({ immutableTypes: true })

		expect(() =>
			mutableTypes(() => {
				throw new Error('build')
			})
		).toThrow('build')
		expect(System.Settings.Get().immutableTypes).toBe(true)
	})

	it('leaves the setting alone when it is already off', () => {
		System.Settings.Set({ immutableTypes: false })
		const set = spyOn(System.Settings, 'Set')

		try {
			expect(mutableTypes(() => 1)).toBe(1)
			expect(set).not.toHaveBeenCalled()
		} finally {
			set.mockRestore()
		}
	})
})

// TypeBox >= 1.4 composes by sharing the caller's nodes: a direct validator
// must own its schema and models like `.model()` does, or it wraps the
// caller's check
const modelOwnership = () => {
	for (const [name, create, wrap] of [
		[
			'the root schema',
			(models: any) => Validator.create(models.M),
			(value: unknown) => value
		],
		[
			'a named model',
			(models: any) => Validator.create('M', { models }),
			(value: unknown) => value
		],
		[
			'an inline t.Ref',
			(models: any) =>
				Validator.create(t.Object({ m: t.Ref('M') }) as any, {
					models
				}),
			(value: unknown) => ({ m: value })
		]
	] as const)
		it(`leaves the caller's model untouched through ${name}`, () => {
			const M = t.Object({ a: Even() })
			const check = M.properties.a['~refine'][0].check
			const frozen = Object.isFrozen(M)
			const validator: any = create({ M })

			expect(validator.Check(wrap({ a: 'ab' }))).toBe(true)
			expect(validator.Check(wrap({ a: 'abc' }))).toBe(false)
			expect(M.properties.a['~refine'][0].check).toBe(check)
			expect(Object.isFrozen(M)).toBe(frozen)
		})
}

modelOwnership()

// a model keyed `__proto__` must not become the copy's prototype
it('keeps a __proto__ model on an inline t.Ref', () => {
	const models = Object.fromEntries([['__proto__', t.Number()]])

	expect(Validator.create(t.Ref('__proto__'), { models }).Check('x')).toBe(
		false
	)
})

describe.skipIf(!Bun.semver.satisfies(typeboxPackage.version, '>=1.4.0'))(
	'TypeBox immutableTypes',
	() => {
		const previous = System.Settings.Get().immutableTypes

		beforeAll(() => System.Settings.Set({ immutableTypes: true }))
		afterAll(() => System.Settings.Set({ immutableTypes: previous }))
		afterEach(() => {
			Compiled.clear()
			Validator.clear()
		})

		it('validates a body through a refined model', () =>
			expectValidates(
				new Elysia()
					.model({ User: t.Object({ name: Even() }) })
					.post('/', { body: 'User' }, () => 'ok'),
				json({ name: 'ab' }),
				json({ name: 'abc' })
			))

		it('validates an inline t.Ref to a refined model', () =>
			expectValidates(
				new Elysia()
					.model({ User: t.Object({ name: Even() }) })
					.post(
						'/',
						{ body: t.Object({ user: t.Ref('User') }) },
						() => 'ok'
					),
				json({ user: { name: 'ab' } }),
				json({ user: { name: 'abc' } })
			))

		for (const mode of ['eager', 'frozen'])
			describe(`${mode} query`, () => {
				it('validates a nested object', () =>
					expectValidates(
						buildMode(mode, () =>
							new Elysia().get(
								'/',
								{
									query: t.Object({
										o: t.Object({ a: t.String() })
									})
								},
								() => 'ok'
							)
						),
						query({ a: 'x' }),
						query({ a: 1 })
					))

				it('validates a nested object with an inner refine', () =>
					expectValidates(
						buildMode(mode, () =>
							new Elysia().get(
								'/',
								{
									query: t.Object({
										o: t.Object({ a: Even() })
									})
								},
								() => 'ok'
							)
						),
						query({ a: 'ab' }),
						query({ a: 'abc' })
					))

				it('validates an array of strings', () =>
					expectValidates(
						buildMode(mode, () =>
							new Elysia().get(
								'/',
								{
									query: t.Object({
										o: t.Array(t.String(), { minItems: 2 })
									})
								},
								() => 'ok'
							)
						),
						query(['x', 'y']),
						query(['x'])
					))
			})

		it('validates a nested object in a multipart body', () =>
			expectValidates(
				new Elysia().post(
					'/',
					{ body: t.Object({ meta: t.Object({ a: t.String() }) }) },
					() => 'ok'
				),
				form({ a: 'x' }),
				form({ a: 1 })
			))

		it('decodes a model t.Date body', async () => {
			let received: unknown
			const app = new Elysia()
				.model({ When: t.Object({ at: t.Date() }) })
				.post('/', { body: 'When' }, ({ body }) => {
					received = body.at
					return 'ok'
				})

			await expectValidates(
				app,
				json({ at: '2020-01-01' }),
				json({ at: 'never' })
			)
			expect(received).toBeInstanceOf(Date)
		})

		// options outside the merge fast path send the guard through
		// Evaluate(Intersect(...))
		it('validates a merged guard that needs Evaluate', () =>
			expectValidates(
				new Elysia()
					.guard({
						schema: 'merge',
						body: t.Object(
							{ b: Even() },
							{ additionalProperties: false }
						)
					})
					.post(
						'/',
						{
							body: t.Object(
								{ a: t.String() },
								{ minProperties: 1 }
							)
						},
						() => 'ok'
					),
				json({ a: 'x', b: 'ab' }),
				json({ a: 'x', b: 'abc' })
			))

		it('validates a merged guard over a model that needs Evaluate', () =>
			expectValidates(
				new Elysia()
					.model({
						User: t.Object({ a: t.String() }, { minProperties: 1 })
					})
					.guard({
						schema: 'merge',
						body: t.Object(
							{ b: Even() },
							{ additionalProperties: false }
						)
					})
					.post('/', { body: 'User' }, () => 'ok'),
				json({ a: 'x', b: 'ab' }),
				json({ a: 'x', b: 'abc' })
			))

		// a sealed (bridge-free) route rebuilds its JSON string coercion from
		// the build's plan instead of t.ObjectString
		it('seals a query nested object from the coerce plan', () => {
			const schema = t.Object({ o: t.Object({ a: Even() }) })
			let claimed: any

			process.env.ELYSIA_AOT_BUILD = '1'
			try {
				beginValidatorCapture()
				new Elysia().get('/', { query: schema }, () => 'ok').compile()
				const captured = endValidatorCapture()
				endHandlerCapture()
				Compiled.clear()
				Validator.clear()
				claimed = claimManifest({ validators: materialise(captured) })
			} finally {
				delete process.env.ELYSIA_AOT_BUILD
			}

			const sealed: any = buildFrozenRouteValidator(
				{ query: schema } as any,
				claimed,
				'GET',
				'/'
			)

			expect(sealed?.query).toBeDefined()
			expect(sealed.query.From({ o: { a: 'ab' } }, 'query')).toEqual({
				o: { a: 'ab' }
			})
			expect(() =>
				sealed.query.From({ o: { a: 'abc' } }, 'query')
			).toThrow()
		})

		modelOwnership()

		// a direct validator owns a copy of the caller's schema, like a route
		it("validates the caller's frozen refine through a direct validator", () => {
			const schema = t.Object({ a: Even() })
			const check = schema.properties.a['~refine'][0].check
			const validator: any = Validator.create(schema)

			expect(validator.Check({ a: 'ab' })).toBe(true)
			expect(validator.Check({ a: 'abc' })).toBe(false)
			expect(schema.properties.a['~refine'][0].check).toBe(check)
			expect(Object.isFrozen(schema.properties.a['~refine'][0])).toBe(
				true
			)
		})

		// a secondary schema is merged in by reference, refinements included
		it('validates a frozen refine in a merged secondary schema', () => {
			const secondary = t.Object({ r: Even() })
			const check = secondary.properties.r['~refine'][0].check
			const validator: any = Validator.create(
				t.Object({ a: t.String() }),
				{
					schemas: [secondary]
				}
			)

			expect(validator.Check({ a: 'x', r: 'ab' })).toBe(true)
			expect(validator.Check({ a: 'x', r: 'abc' })).toBe(false)
			expect(secondary.properties.r['~refine'][0].check).toBe(check)
		})

		// the named-model merge takes the secondaries again, owned the same way
		it('validates a frozen refine in a secondary merged into a named model', () => {
			const M = t.Object({ a: t.String() })
			const secondary = t.Object({ r: Even() })
			const check = secondary.properties.r['~refine'][0].check
			const validator: any = Validator.create('M', {
				models: { M },
				schemas: [secondary]
			})

			expect(validator.Check({ a: 'x', r: 'ab' })).toBe(true)
			expect(validator.Check({ a: 'x', r: 'abc' })).toBe(false)
			expect(secondary.properties.r['~refine'][0].check).toBe(check)
		})

		// a Standard Schema member makes a MultiValidator, which compiles each
		// TypeBox member itself
		it('validates a frozen refine through a mixed validator', () => {
			const validator: any = Validator.create(Even(), {
				schemas: [z.string()]
			})

			expect(validator.Check('ab')).toBe(true)
			expect(validator.Check('abc')).toBe(false)
		})

		// a schema the snapshot cannot clone (a prototype with methods) stays
		// the caller's: a frozen refine must say why, not a readonly TypeError
		const unclonable = (schema: any) =>
			Object.create(
				{ describe() {} },
				Object.getOwnPropertyDescriptors(schema)
			)

		it('names the cause when a validator keeps a frozen refine', () => {
			expect(() => Validator.create(unclonable(Even()))).toThrow(
				't.Refine entry is frozen (TypeBox immutableTypes) and the schema could not be snapshotted: use a plain-object schema'
			)
		})

		// a check Elysia already guarded skips the guard, not the group wrap
		it('names the cause for an already guarded check too', () => {
			System.Settings.Set({ immutableTypes: false })
			const first = Even()
			Validator.create(unclonable(first))
			const guarded = first['~refine'][0].check
			System.Settings.Set({ immutableTypes: true })

			expect(() =>
				Validator.create(
					unclonable(t.Refine(t.String(), guarded as any, () => 'e'))
				)
			).toThrow(
				't.Refine entry is frozen (TypeBox immutableTypes) and the schema could not be snapshotted'
			)
		})

		// keep last: deep-freezes the process-wide t.Date / t.File bases, see
		// the note at the top of the file
		describe('shared bases', () => {
			// Elysia's shared bases are frozen by any 1.4 builder handed one, e.g.
			// t.Date({ ... }) freezes the node every t.Date() returns
			it('validates direct validators over shared bases', () => {
				const date = t.Date()
				t.Date({ minimumTimestamp: 0 })
				t.File({ minSize: 1 })

				const cases: [any, unknown, unknown][] = [
					[date, new Date(), 'never'],
					[t.File(), new File(['x'], 'a.txt'), 'x'],
					[t.ArrayBuffer(), new ArrayBuffer(1), 'x'],
					[t.Uint8Array(), new Uint8Array(1), 'x'],
					[
						t.Form({ x: t.String() }),
						elysiaForm({ x: 'a' }),
						elysiaForm({ x: 1 })
					]
				]

				for (const [schema, valid, invalid] of cases) {
					const validator: any = Validator.create(schema)
					expect(validator.Check(valid)).toBe(true)
					expect(validator.Check(invalid)).toBe(false)
				}
			})
		})
	}
)
