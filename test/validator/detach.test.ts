import { describe, expect, it } from 'bun:test'

import { form, t } from '../../src'
import {
	detachValidatorCompiler,
	StandardValidator,
	trackValidatorCompiler,
	Validator
} from '../../src/validator'
import {
	RouteValidator,
	sealRouteValidatorExecutors
} from '../../src/validator/route'
import { validationPlan } from '../../src/validator/validation-plan'
import { compactDiagnosticSchema } from '../../src/validator/compact-errors'
import { ELYSIA_TYPES } from '../../src/type/constants'

const fixture = new URL('./detach.fixture.ts', import.meta.url).pathname
const codecFixture = new URL('./detach-codec.fixture.ts', import.meta.url)
	.pathname
const planRetentionFixture = new URL(
	'./detach-plan-retention.fixture.ts',
	import.meta.url
).pathname

const build = (schema: any, options: Record<string, unknown> = {}) => {
	const root = {}
	const validator: any = new RouteValidator(
		{ body: schema },
		{ app: root, ...options }
	).body

	return { root, validator }
}

describe('production validator detachment', () => {
	it('seals one route without draining unrelated root-tracked executors', () => {
		const root = {}
		const sharedResponse: any = Validator.create(
			t.Object({ ok: t.Boolean() })
		)
		const sealSharedResponse = sharedResponse.seal.bind(sharedResponse)
		let sharedResponseSealCalls = 0
		sharedResponse.seal = (introspect: boolean) => {
			sharedResponseSealCalls++
			sealSharedResponse(introspect)
		}
		const selected: any = new RouteValidator(
			{
				body: t.Object({ body: t.String() }),
				headers: t.Object({ header: t.String() }),
				query: t.Object({ query: t.String() }),
				params: t.Object({ param: t.String() }),
				cookie: t.Object({ cookie: t.String() }),
				response: {
					200: sharedResponse,
					201: sharedResponse
				}
			},
			{ app: root }
		)
		const unrelated: any = new RouteValidator(
			{ body: t.Object({ untouched: t.Number() }) },
			{ app: root }
		)
		const selectedExecutors = [
			selected.body,
			selected.headers,
			selected.query,
			selected.params,
			selected.cookie,
			...Object.values(selected.response)
		] as any[]

		expect(selectedExecutors.every((validator) => validator.schema)).toBeTrue()
		expect(unrelated.body.schema).toBeDefined()

		sealRouteValidatorExecutors(selected)
		expect(sharedResponseSealCalls).toBe(1)

		for (const validator of selectedExecutors) {
			expect(validator.schema).toBeUndefined()
			expect(validator.tb).toBeUndefined()
		}
		expect(unrelated.body.schema).toBeDefined()

		// Local sealing leaves root tracking intact for the eventual global detach.
		detachValidatorCompiler(root)
		expect(sharedResponseSealCalls).toBe(2)
		expect(unrelated.body.schema).toBeUndefined()
	})

	it('drops the raw schema and compiler while preserving validation and errors', () => {
		const { root, validator } = build(t.Object({ value: t.Number() }))

		detachValidatorCompiler(root)

		expect(validator.schema).toBeUndefined()
		expect(validator.tb).toBeUndefined()
		expect(validator.FromSync({ value: 1 }, 'body')).toEqual({ value: 1 })
		expect(() => validator.FromSync({ value: 'no' }, 'body')).toThrow()

		try {
			validator.FromSync({ value: 'no' }, 'body')
		} catch (error: any) {
			expect(error.errors[0].instancePath).toBe('/value')
		}
	})

	it('preserves constrained error details and expected values after sealing', () => {
		const cases: [any, unknown][] = [
			[t.Number({ minimum: 5 }), 2],
			[t.String({ minLength: 3 }), 'a'],
			[t.Array(t.String(), { minItems: 2 }), []],
			[t.Date(), 'invalid'],
			[
				t.Object({ d: t.Date(), n: t.Number({ minimum: 5 }) }),
				{ d: new Date('2020-01-01'), n: 2 }
			],
			[
				t.Object({ d: t.Date(), n: t.Number({ minimum: 5 }) }),
				{ d: '2020-01-01', n: 2 }
			]
		]

		for (const [schema, value] of cases) {
			const validator: any = Validator.create(schema)
			const payload = () => {
				try {
					validator.FromSync(value, 'body')
				} catch (error: any) {
					return error.payload
				}
			}
			const before = payload()

			validator.seal(false)

			expect(payload()).toEqual(before)
		}

		const params: any = new RouteValidator({
			params: t.Object({
				id: t.Integer({ minimum: 5 }),
				d: t.Date()
			})
		}).params
		const payload = () => {
			try {
				params.FromSync({ id: '7', d: 'invalid' }, 'params')
			} catch (error: any) {
				return error.payload
			}
		}
		const before = payload()

		params.seal(false)

		expect(payload()).toEqual(before)
	})

	it('keeps structural string codec failures at the root after sealing', () => {
		const validator: any = new RouteValidator(
			{
				query: t.Object({
					filter: t.ObjectString({
						min: t.Number(),
						label: t.String()
					}),
					ids: t.ArrayString(t.Number())
				})
			},
			{ normalize: true }
		).query
		const property = (value: unknown) => {
			try {
				validator.FromSync(value, 'query')
			} catch (error: any) {
				return error.payload.property
			}
		}

		validator.seal(false)
		expect(
			property({
				filter: '{"min":"x","label":"a"}',
				ids: '[1,2,3]'
			})
		).toBe('root')
		expect(
			property({
				filter: '{"min":1,"label":"a"}',
				ids: '[1,"x"]'
			})
		).toBe('root')
	})

	it('does not trust a user-supplied coercion type marker', () => {
		const snapshot: any = compactDiagnosticSchema({
			type: 'number',
			'~elyTyp': ELYSIA_TYPES.Numeric
		})

		expect(snapshot['~coerceRootFallback']).toBeUndefined()
	})

	it('keeps a later failure at the root after an accepted coercion', () => {
		const validator: any = new RouteValidator(
			{
				body: t.Object({
					coerced: t.Numeric(),
					tail: t.Literal('ok')
				})
			},
			{ normalize: true }
		).body
		validator.seal(false)
		const property = (value: unknown) => {
			try {
				validator.FromSync(value, 'body')
			} catch (error: any) {
				return error.payload.property
			}
			throw new Error('expected the invalid value to be rejected')
		}

		expect(property({ coerced: '1', tail: 'bad' })).toBe('root')
		expect(property({ coerced: 'bad', tail: 'ok' })).toBe('root')
	})

	it('preserves defaults, codecs, sanitize, forms, and refinements', async () => {
		const cases: [any, any, any, Record<string, unknown>?][] = [
			[t.Object({ value: t.Number({ default: 1 }) }), {}, { value: 1 }],
			[
				t.Object({ when: t.Date(), count: t.Numeric() }),
				{ when: '2020-01-01T00:00:00.000Z', count: '2' },
				{ when: new Date('2020-01-01T00:00:00.000Z'), count: 2 }
			],
			[
				t.Object({ value: t.String() }),
				{ value: '<' },
				{ value: '&lt;' },
				{
					sanitize: (value: unknown) =>
						value === '<' ? '&lt;' : value
				}
			],
			[
				t.Form({ value: t.String() }),
				form({ value: 'ok' }),
				{ value: 'ok' }
			],
			[t.Refine(t.String(), (value) => value === 'ok'), 'ok', 'ok']
		]

		for (const [schema, input, expected, options] of cases) {
			const { root, validator } = build(schema, options)
			detachValidatorCompiler(root)
			expect(await validator.From(input, 'body')).toEqual(expected)
			expect(validator.schema).toBeUndefined()
		}
	})

	it('materializes TypeBox cleanup across structural schema nodes', () => {
		const cyclic = t.Cyclic(
			{
				Node: t.Object({
					value: t.String(),
					child: t.Union([t.Ref('Node'), t.Null()])
				})
			},
			'Node'
		)
		const cases: [any, unknown, unknown][] = [
			[
				t.Array(t.Object({ value: t.String() })),
				[{ value: 'a', extra: 1 }],
				[{ value: 'a' }]
			],
			[
				t.Tuple([t.Object({ value: t.String() })]),
				[{ value: 'a', extra: 1 }],
				[{ value: 'a' }]
			],
			[
				t.Union([
					t.Object({ kind: t.Literal('a'), value: t.String() }),
					t.Object({ kind: t.Literal('b'), count: t.Number() })
				]),
				{ kind: 'b', count: 1, extra: true },
				{ kind: 'b', count: 1 }
			],
			[
				t.Intersect([
					t.Object({ left: t.String() }),
					t.Object({ right: t.Number() })
				]),
				{ left: 'a', right: 1, extra: true },
				{ left: 'a', right: 1 }
			],
			[
				t.Record(t.String(), t.Object({ value: t.String() })),
				{ key: { value: 'a', extra: true } },
				{ key: { value: 'a', extra: true } }
			],
			[
				cyclic,
				{
					value: 'root',
					extra: true,
					child: { value: 'leaf', extra: true, child: null }
				},
				{
					value: 'root',
					extra: true,
					child: { value: 'leaf', extra: true, child: null }
				}
			]
		]

		for (const [schema, input, expected] of cases) {
			const { root, validator } = build(schema, { normalize: 'typebox' })
			detachValidatorCompiler(root)
			expect(validator.FromSync(input, 'body')).toEqual(expected)
			expect(validator.schema).toBeUndefined()
		}
	})

	it('materializes non-preallocatable defaults and seals idempotently', () => {
		const proto = t.Object({ value: t.String({ default: 'safe' }) })
		const properties = Object.defineProperty({}, '__proto__', {
			value: proto,
			enumerable: true
		})
		const { root, validator } = build(t.Object(properties as any))
		const input = Object.defineProperty({}, '__proto__', {
			value: {},
			writable: true,
			enumerable: true,
			configurable: true
		})

		detachValidatorCompiler(root)
		validator.seal(false)
		validator.seal(true)

		const result = validator.FromSync(input, 'body')
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
		expect(Object.hasOwn(result, '__proto__')).toBeTrue()
		expect(result.__proto__).toEqual({ value: 'safe' })
		expect(validator.schema).toBeUndefined()
	})

	it('materializes and detaches a validation-plan oracle before runtime', () => {
		const root = {}
		const validator: any = new RouteValidator(
			{ query: t.Object({ value: t.Number() }) },
			{ app: root, validationPlan }
		).query

		detachValidatorCompiler(root)

		expect(validator.schema).toBeUndefined()
		expect(validator.FromSync({ value: '2' }, 'query')).toEqual({
			value: 2
		})
		expect(() => validator.FromSync({ value: 'no' }, 'query')).toThrow()
	})

	it('detaches runtime validators in introspection mode too', () => {
		const { root, validator } = build(t.Object({ value: t.Number() }))

		detachValidatorCompiler(root, true)

		expect(validator.schema).toBeUndefined()
		expect(validator.tb).toBeUndefined()
		expect(validator.FromSync({ value: 1 })).toEqual({ value: 1 })
		try {
			validator.FromSync({ value: 'no' }, 'body')
		} catch (error: any) {
			expect(error.errors[0].instancePath).toBe('/value')
		}
	})

	it('retains only the Standard Schema validate callback', () => {
		const validate = (value: unknown) => ({ value })
		const schema = { '~standard': { version: 1, vendor: 'test', validate } }
		const validator: any = new StandardValidator(schema as any)

		expect(Object.getOwnPropertyNames(validator)).not.toContain('schema')
		expect(validator.From('ok')).toBe('ok')
	})

	it('does not retain schema graphs through callbacks or caches', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, fixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
			reachable: false,
			annotationReachable: false,
			valid: { date: true, count: 1, name: 'ok', annotation: 1 },
			custom: 'name'
		})
	})

	it('does not retain schemas through detached operation plans', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, planRetentionFixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
			alive: []
		})
	})

	it('serves request and response codecs in every normalization mode', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, codecFixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual(
			[false, 'typebox'].map((normalize) => ({
				normalize,
				requestStatus: 200,
				request: {
					date: '2020-01-01T00:00:00.000Z',
					isDate: true
				},
				responseStatus: 200,
				response: { date: '2020-01-01T00:00:00.000Z' },
				generation: true
			}))
		)
	})

	it('preserves the full response encode pipeline without a mirror', () => {
		for (const normalize of [undefined, false] as const) {
			const properties = Object.assign(Object.create(null), {
				d: t.Numeric(),
				y: t.Number(),
				x: t.String({ default: 'x' })
			})
			Object.defineProperty(properties, '__proto__', {
				value: t.Optional(t.String()),
				enumerable: true
			})
			const root = {}
			const validator: any = Validator.create(t.Object(properties), {
				app: root,
				slot: 'response:200',
				normalize
			})
			trackValidatorCompiler(root, validator)

			detachValidatorCompiler(root)

			expect(validator.EncodeFrom({ d: 2, y: '2' })).toEqual({
				d: 2,
				y: 2,
				x: 'x'
			})
			expect(validator.schema).toBeUndefined()
		}
	})

	it('preserves NoValidate unsafe response codec behavior after sealing', () => {
		const root = {}
		const validator: any = Validator.create(t.NoValidate(t.Date()), {
			app: root,
			slot: 'response:200',
			normalize: false
		})
		trackValidatorCompiler(root, validator)
		const date = new Date('2025-01-01T00:00:00.000Z')

		detachValidatorCompiler(root)

		expect(validator.EncodeFrom(date)).toBe(date.toISOString())
		expect(validator.EncodeFrom('not-a-date')).toBe('not-a-date')
	})
})
