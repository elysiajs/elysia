import { describe, expect, it } from 'bun:test'
import { Settings } from 'typebox/system'

import { Elysia } from '../../src'
import { t } from '../../src/type'
import { RouteValidator } from '../../src/validator/route'
import {
	validationPlan,
	ValidationPlanValidator
} from '../../src/experimental/validation-plan'
import { Validator } from '../../src/validator'
import { getQueryParseChannels } from '../../src/parse-query'
import {
	createValidationPlan,
	executeValidationPlan,
	VALIDATION_FAILED,
	type ValidationScratch
} from '../../src/validator/validation-plan'

const run = (
	schema: any,
	value: unknown,
	domain: 'json' | 'string' | 'encode'
) => {
	const plan = createValidationPlan(schema, domain)
	expect(plan).toBeDefined()
	const scratch: ValidationScratch = { pc: -1, path: [], failurePath: '' }
	return {
		result: executeValidationPlan(plan!.root, value, scratch),
		scratch
	}
}

describe('ValidationPlan common lane', () => {
	it('rejects an unknown behavioral keyword anywhere in the schema', () => {
		const schema = t.Object({
			profile: t.Object({ name: t.String({ format: 'email' }) })
		})

		expect(createValidationPlan(schema, 'json')).toBeUndefined()
		expect(
			createValidationPlan(
				t.Object({ value: t.Refine(t.String(), () => true) }),
				'json'
			)
		).toBeUndefined()
	})

	it('rejects forged Elysia tags, accessors, and non-JSON defaults', () => {
		const forged: any = {
			'~kind': 'Union',
			'~elyTyp': 4,
			anyOf: [t.Object({ value: t.String() }), t.String()]
		}
		expect(createValidationPlan(forged, 'string')).toBeUndefined()
		expect(
			createValidationPlan(t.Numeric({ minimum: 0 }), 'string')
		).toBeDefined()
		const mutated: any = t.Numeric({ minimum: 1 })
		mutated.anyOf[1]['~codec'].decode = () => 999
		expect(createValidationPlan(mutated, 'string')).toBeUndefined()

		const accessor: any = { ...t.String({ description: 'x' }) }
		Object.defineProperty(accessor, '~kind', { value: 'String' })
		Object.defineProperty(accessor, 'description', { get: () => 'x' })
		expect(createValidationPlan(accessor, 'json')).toBeUndefined()
		let discriminantReads = 0
		const discriminantAccessor: any = { type: 'string' }
		Object.defineProperty(discriminantAccessor, '~kind', {
			get() {
				discriminantReads++
				return 'String'
			}
		})
		expect(
			createValidationPlan(discriminantAccessor, 'json')
		).toBeUndefined()
		expect(discriminantReads).toBe(0)
		const inheritedBehavior = Object.assign(
			Object.create({
				'~refine': [{ check: () => false, error: () => 'blocked' }]
			}),
			{ type: 'string' }
		)
		Object.defineProperty(inheritedBehavior, '~kind', { value: 'String' })
		expect(createValidationPlan(inheritedBehavior, 'json')).toBeUndefined()
		const mismatchedLiteral = {
			type: 'string',
			const: 1,
			'~kind': 'Literal'
		}
		expect(
			createValidationPlan(mismatchedLiteral as any, 'json')
		).toBeUndefined()

		expect(
			createValidationPlan(
				t.String({ default: () => 'x' as any }),
				'json'
			)
		).toBeUndefined()
		expect(
			createValidationPlan(
				t.String({ default: Symbol('x') as any }),
				'json'
			)
		).toBeUndefined()
		const hiddenDefault = {}
		Object.defineProperty(hiddenDefault, 'hidden', { value: 'x' })
		expect(
			createValidationPlan(
				t.Object({}, { default: hiddenDefault }),
				'json'
			)
		).toBeUndefined()
	})

	it('builds into scratch, applies nested defaults, and never mutates input', () => {
		const schema = t.Object({
			profile: t.Object(
				{
					name: t.String({ default: 'elysia' }),
					age: t.Integer()
				},
				{ default: {} }
			),
			late: t.Boolean()
		})
		const input = { late: 'not-a-boolean' }
		const { result, scratch } = run(schema, input, 'json')

		expect(result).toBe(VALIDATION_FAILED)
		expect(scratch.pc).toBeGreaterThanOrEqual(0)
		expect(scratch.failurePath).toBe('/profile/age')
		expect(input).toEqual({ late: 'not-a-boolean' })

		const valid = run(schema, { profile: { age: '2' }, late: true }, 'json')
		expect(valid.result).toEqual({
			profile: { name: 'elysia', age: 2 },
			late: true
		})
	})

	it('parses structural strings once and preserves codec branch checks', () => {
		const schema = t.Object({
			filter: t.ObjectString({
				take: t.Number(),
				name: t.String({ default: 'elysia' })
			}),
			ids: t.ArrayString(t.Number())
		})
		const original = JSON.parse
		let parses = 0
		JSON.parse = ((value: string) => {
			parses++
			return original(value)
		}) as typeof JSON.parse

		try {
			expect(
				run(
					schema,
					{ filter: '{"take":2,"name":"x"}', ids: '[1,2,3]' },
					'string'
				).result
			).toEqual({ filter: { take: 2, name: 'x' }, ids: [1, 2, 3] })
			expect(parses).toBe(2)
		} finally {
			JSON.parse = original
		}

		const oracle: any = new RouteValidator(
			{ query: schema },
			{ normalize: true }
		).query
		const candidate: any = new RouteValidator(
			{ query: schema },
			{ normalize: true, validationPlan }
		).query
		const settle = (validator: any, input: unknown) => {
			try {
				return { ok: true, value: validator.FromSync(input, 'query') }
			} catch {
				return { ok: false }
			}
		}
		for (const input of [
			{ filter: ' {"take":2,"name":"x"}', ids: '[1,2]' },
			{ filter: '{"take":2}', ids: '[1,2]' },
			{ filter: '{"take":2,"name":"x"}', ids: '["1","2"]' }
		])
			expect(settle(candidate, input)).toEqual(settle(oracle, input))

		const explicit = t.Object({
			filter: t.ObjectString({
				n: t.Numeric(),
				b: t.BooleanString()
			}),
			ids: t.ArrayString(t.Numeric())
		})
		const explicitOracle: any = new RouteValidator(
			{ query: explicit },
			{ normalize: true }
		).query
		const explicitCandidate: any = new RouteValidator(
			{ query: explicit },
			{ normalize: true, validationPlan }
		).query
		expect(
			explicitCandidate.FromSync(
				{ filter: '{"n":"2","b":"true"}', ids: '["1","2"]' },
				'query'
			)
		).toEqual(
			explicitOracle.FromSync(
				{ filter: '{"n":"2","b":"true"}', ids: '["1","2"]' },
				'query'
			)
		)

		const minAfterDefault = t.Object({
			filter: t.ObjectString(
				{ value: t.Optional(t.String({ default: 'x' })) },
				{ minProperties: 1 }
			)
		})
		const minOracle: any = new RouteValidator(
			{ query: minAfterDefault },
			{ normalize: true }
		).query
		const minCandidate: any = new RouteValidator(
			{ query: minAfterDefault },
			{ normalize: true, validationPlan }
		).query
		expect(settle(minCandidate, { filter: '{}' })).toEqual(
			settle(minOracle, { filter: '{}' })
		)
	})

	it('fails closed for unsupported object semantics', () => {
		const unknownRequired: any = t.Object({ value: t.String() })
		unknownRequired.required.push('ghost')
		expect(createValidationPlan(unknownRequired, 'string')).toBeUndefined()
		expect(
			createValidationPlan(
				t.Object({ value: t.String() }, { additionalProperties: true }),
				'string'
			)
		).toBeUndefined()

		const additions = t.Object(
			{ b: t.String(), a: t.String() },
			{ additionalProperties: true }
		)
		const validator: any = new RouteValidator(
			{ query: additions },
			{ normalize: true, validationPlan }
		).query
		expect(validator).not.toBeInstanceOf(ValidationPlanValidator)
		expect(
			JSON.stringify(validator.FromSync({ b: 'b', z: 'z', a: 'a' }))
		).toBe('{"b":"b","z":"z","a":"a"}')
	})

	it('writes dangerous schema keys as own data properties', () => {
		const properties = Object.create(null)
		properties.__proto__ = t.String()
		const schema = t.Object(properties)
		const input = Object.create(null)
		input.__proto__ = 'safe'

		const { result } = run(schema, input, 'json')
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
		expect(Object.hasOwn(result as object, '__proto__')).toBe(true)
		expect((result as any).__proto__).toBe('safe')

		for (const key of ['__proto__', 'constructor', 'prototype']) {
			const queryProperties = Object.create(null)
			queryProperties[key] = t.String()
			const querySchema = t.Object(queryProperties)
			const candidate: any = new RouteValidator(
				{ query: querySchema },
				{ normalize: true, validationPlan }
			).query
			const input = Object.create(null)
			input[key] = 'safe'

			expect(candidate).not.toBeInstanceOf(ValidationPlanValidator)
			expect(
				Object.getPrototypeOf(candidate.FromSync(input, 'query'))
			).toBeNull()
		}
	})

	it('uses encode plans only for callback-free response schemas', () => {
		const properties = Object.create(null)
		properties.__proto__ = t.String()
		properties.value = t.Number()
		const schema = t.Object(properties)
		const input = Object.create(null)
		input.__proto__ = 'safe'
		input.value = 1
		input.extra = true

		const candidate = new RouteValidator(
			{ response: { 200: schema } },
			{
				validationPlan,
				aot: { method: 'GET', path: '/encode-plan' }
			}
		).response![200] as any
		expect(candidate).toBeInstanceOf(ValidationPlanValidator)
		const encoded = candidate.EncodeFrom(input, 'response')
		expect(encoded.value).toBe(1)
		expect(Object.keys(encoded)).toEqual(['__proto__', 'value'])
		expect(Object.hasOwn(encoded, '__proto__')).toBe(true)
		expect(Object.getPrototypeOf(encoded)).toBe(Object.prototype)

		let calls = 0
		const codec = t.Object({
			value: t
				.Codec(t.String())
				.Decode((value: string) => Number(value))
				.Encode((value: number) => {
					calls++
					return String(value)
				})
		})
		const fallback = new RouteValidator(
			{ response: { 200: codec } },
			{
				validationPlan,
				aot: { method: 'GET', path: '/encode-codec' }
			}
		).response![200] as any
		expect(fallback).not.toBeInstanceOf(ValidationPlanValidator)
		expect(fallback.EncodeFrom({ value: 2 }, 'response')).toEqual({
			value: '2'
		})
		expect(calls).toBe(1)
		expect(createValidationPlan(codec, 'encode')).toBeUndefined()
		expect(
			createValidationPlan(t.Array(t.String()), 'encode')
		).toBeUndefined()
		expect(
			createValidationPlan(
				t.Object({ items: t.Array(t.String()) }),
				'encode'
			)
		).toBeUndefined()

		const arraySchema = t.Object({ items: t.Array(t.String()) })
		const arrayFallback = new RouteValidator(
			{ response: { 200: arraySchema } },
			{
				validationPlan,
				aot: { method: 'GET', path: '/encode-array' }
			}
		).response![200] as any
		const items = ['x']
		Object.defineProperty(items, 'toJSON', {
			value: () => ['changed']
		})
		expect(arrayFallback).not.toBeInstanceOf(ValidationPlanValidator)
		expect(arrayFallback.EncodeFrom({ items }, 'response').items).toBe(items)
		expect(
			createValidationPlan(
				t.Object({ value: t.String({ default: 'x' }) }),
				'encode'
			)
		).toBeUndefined()
	})

	it('selects the candidate for benchmark shapes and keeps its oracle cold', () => {
		const schemas = [
			t.Object({
				page: t.Number(),
				active: t.Boolean(),
				limit: t.Integer()
			}),
			t.Object({ filter: t.ObjectString({ take: t.Number() }) }),
			t.Object({ ids: t.ArrayString(t.Number()) })
		]
		for (const query of schemas) {
			const validator = new RouteValidator(
				{ query },
				{ normalize: true, validationPlan }
			).query
			expect(validator).toBeInstanceOf(ValidationPlanValidator)
		}
		const app = {}
		const shared = t.Object({ value: t.Number() })
		const first = new RouteValidator(
			{ query: shared },
			{ app, normalize: true, validationPlan }
		).query
		const second = new RouteValidator(
			{ query: shared },
			{ app, normalize: true, validationPlan }
		).query
		expect(first).toBe(second)
		const exotic = new RouteValidator(
			{ body: t.Object({ value: t.Refine(t.String(), () => true) }) },
			{ normalize: true, validationPlan }
		).body
		expect(exotic).not.toBeInstanceOf(ValidationPlanValidator)

		const schema = t.Object({ value: t.Number() })
		const plan = createValidationPlan(schema, 'json')!
		let oracleCalls = 0
		const validator = new ValidationPlanValidator(schema, plan, (() => {
			oracleCalls++
			return {
				FromSync: () => ({ value: -1 })
			}
		}) as any)

		expect(validator.FromSync({ value: 1 })).toEqual({ value: 1 })
		expect(oracleCalls).toBe(0)
		expect(validator.FromSync({ value: 'bad' })).toEqual({ value: -1 })
		expect(oracleCalls).toBe(1)
	})

	it('snapshots only required oracle options', () => {
		let appReads = 0
		const options: any = {
			normalize: true,
			slot: 'query',
			validationPlan,
			get app() {
				appReads++
				return {}
			}
		}
		const validator: any = Validator.create(
			t.Object({ value: t.Number() }),
			options
		)
		const readsAfterConstruction = appReads

		expect(() => validator.FromSync({ value: 'bad' }, 'query')).toThrow()
		expect(appReads).toBe(readsAfterConstruction)
	})

	it('falls back for an obsolete boolean direct option', () => {
		const validator = new RouteValidator(
			{ query: t.Object({ value: t.Number() }) },
			{ normalize: true, validationPlan: true as any }
		).query

		expect(validator).not.toBeInstanceOf(ValidationPlanValidator)
	})

	it('preserves built-in plan identity through route schema snapshots', async () => {
		const app = new Elysia({ experimental: { validationPlan } }).get(
			'/',
			{
				headers: t.Object({
					meta: t.ObjectString({ take: t.Number() })
				})
			},
			(context) => context.headers.meta
		)
		const parse = JSON.parse
		let parses = 0
		JSON.parse = ((value: string) => {
			parses++
			return parse(value)
		}) as typeof JSON.parse

		try {
			const response = await app.handle(
				new Request('http://localhost/', {
					headers: { meta: '{"take":2}' }
				})
			)
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ take: 2 })
			expect(parses).toBe(1)
		} finally {
			JSON.parse = parse
		}
	})

	it('keeps JSON body on the oracle without disabling query or response plans', () => {
		const schema = t.Object({ value: t.String() })
		const validators = new RouteValidator(
			{ body: schema, query: schema, response: { 200: schema } },
			{
				normalize: true,
				validationPlan,
				aot: { method: 'GET', path: '/validation-domain-admission' }
			}
		)

		expect(validators.body).not.toBeInstanceOf(ValidationPlanValidator)
		expect(validators.query).toBeInstanceOf(ValidationPlanValidator)
		expect(validators.response![200]).toBeInstanceOf(
			ValidationPlanValidator
		)

		let customDomain: string | undefined
		const customBody = new RouteValidator(
			{ body: schema },
			{
				normalize: true,
				validationPlan: {
					compose: () => undefined,
					create: (_schema, domain) => {
						customDomain = domain
					}
				}
			}
		).body
		expect(customDomain).toBe('json')
		expect(customBody).not.toBeInstanceOf(ValidationPlanValidator)
	})

	it('keeps JSON body edge semantics on the oracle', () => {
		const schemas = [
			t.Object({ value: t.Integer() }),
			t.Object({ value: t.String({ default: 'elysia' }) }),
			t.Object({ value: t.String() }, { additionalProperties: false }),
			t.Object({ ['__proto__']: t.String() }),
			t.NoValidate(t.Object({ value: t.String() }))
		]

		for (const body of schemas)
			expect(
				new RouteValidator(
					{ body },
					{ normalize: true, validationPlan }
				).body
			).not.toBeInstanceOf(ValidationPlanValidator)

		for (const body of [
			t.Optional(t.String()),
			t.Optional(t.Array(t.String())),
			t.Optional(t.Literal('elysia'))
		])
			expect(
				new RouteValidator(
					{ body },
					{ normalize: true, validationPlan }
				).body
			).not.toBeInstanceOf(ValidationPlanValidator)

		const customCoercion = Validator.create(
			t.Object({ value: t.String() }),
			{
				slot: 'body',
				normalize: true,
				validationPlan,
				coerces: [[[['String', () => t.Number()]]]] as any
			}
		)
		expect(customCoercion).not.toBeInstanceOf(ValidationPlanValidator)

		const noValidate = new RouteValidator(
			{ body: t.NoValidate(t.Object({ value: t.String() })) },
			{ normalize: true, validationPlan }
		).body as any
		expect(noValidate.FromSync({ value: 1 }, 'body')).toEqual({ value: 1 })
	})

	it('keeps the JSON body validator surface identical to the oracle', () => {
		const schema = t.Object({ value: t.String() })
		const oracle = new RouteValidator({ body: schema }, { normalize: true })
			.body as any
		const candidate = new RouteValidator(
			{ body: schema },
			{ normalize: true, validationPlan }
		).body as any
		const input = { value: 'elysia', extra: 'drop' }
		const invalid = { value: 1 }

		expect(candidate.Check(input)).toBe(oracle.Check(input))
		expect(candidate.Errors(invalid)).toEqual(oracle.Errors(invalid))
		expect(candidate.Decode(input)).toEqual(oracle.Decode(input))
		expect(candidate.Encode(input)).toEqual(oracle.Encode(input))
		expect(candidate.EncodeFrom(input, 'body')).toEqual(
			oracle.EncodeFrom(input, 'body')
		)
		expect(candidate.Clean(input)).toEqual(oracle.Clean(input))
	})

	it('keeps params coercion and the public validator surface on the oracle', () => {
		const app = {}
		const shared = t.Object({ value: t.Object({ name: t.String() }) })
		const validators = new RouteValidator(
			{ query: shared, params: shared },
			{ app, normalize: true, validationPlan }
		)
		expect(validators.query).toBeInstanceOf(ValidationPlanValidator)
		expect(validators.params).not.toBeInstanceOf(ValidationPlanValidator)
		expect(() =>
			(validators.params as any).FromSync(
				{ value: '{"name":"elysia"}' },
				'params'
			)
		).toThrow()

		const surface = t.Object({ value: t.String() })
		const oracle: any = new RouteValidator(
			{ query: surface },
			{ normalize: true }
		).query
		const candidate: any = new RouteValidator(
			{ query: surface },
			{ normalize: true, validationPlan }
		).query
		expect(candidate.Decode({ value: 1 })).toEqual(
			oracle.Decode({ value: 1 })
		)
		expect(candidate.Clean({ value: 'x', extra: true })).toEqual(
			oracle.Clean({ value: 'x', extra: true })
		)
	})

	it('does not change query parsing for an ineligible plan', () => {
		const schema = t.Object({
			value: t.Union([t.String(), t.Object({ nested: t.String() })])
		})
		const oracle: any = new RouteValidator(
			{ query: schema },
			{ normalize: true }
		).query
		const candidate: any = new RouteValidator(
			{ query: schema },
			{ normalize: true, validationPlan }
		).query
		expect(candidate).not.toBeInstanceOf(ValidationPlanValidator)
		expect(getQueryParseChannels(candidate.schema)).toEqual(
			getQueryParseChannels(oracle.schema)
		)
	})

	it('keeps root string-domain arrays on the oracle', () => {
		const schema = t.Array(t.Number())
		for (const slot of ['query', 'headers'] as const) {
			const oracle: any = new RouteValidator(
				{ [slot]: schema },
				{ normalize: true }
			)[slot]
			const candidate: any = new RouteValidator(
				{ [slot]: schema },
				{ normalize: true, validationPlan }
			)[slot]

			expect(candidate).not.toBeInstanceOf(ValidationPlanValidator)
			expect(() => oracle.FromSync(['1'], slot)).toThrow()
			expect(() => candidate.FromSync(['1'], slot)).toThrow()
		}
	})

	it('keeps exact optional semantics on the oracle', () => {
		const settings = Settings.Get()
		const previous = settings.exactOptionalPropertyTypes
		try {
			const schema = t.Object({ value: t.Optional(t.String()) })
			const app = {}
			settings.exactOptionalPropertyTypes = false
			const cached = new RouteValidator(
				{ query: schema },
				{ app, normalize: true, validationPlan }
			).query
			expect(cached).toBeInstanceOf(ValidationPlanValidator)

			settings.exactOptionalPropertyTypes = true
			const candidate: any = new RouteValidator(
				{ query: schema },
				{ app, normalize: true, validationPlan }
			).query

			expect(candidate).not.toBeInstanceOf(ValidationPlanValidator)
			expect(() =>
				candidate.FromSync({ value: undefined }, 'query')
			).toThrow()
		} finally {
			settings.exactOptionalPropertyTypes = previous
			Validator.clear()
		}
	})

	it('falls back for inherited/accessor input and omits optional undefined', () => {
		const schema = t.Object({ value: t.Optional(t.String()) })
		const oracle: any = new RouteValidator(
			{ query: schema },
			{ normalize: true }
		).query
		const candidate: any = new RouteValidator(
			{ query: schema },
			{ normalize: true, validationPlan }
		).query

		expect(candidate.FromSync({ value: undefined }, 'query')).toEqual(
			oracle.FromSync({ value: undefined }, 'query')
		)
		const inherited = Object.create({ value: 'inherited' })
		expect(candidate.FromSync(inherited, 'query')).toEqual(
			oracle.FromSync(inherited, 'query')
		)

		let oracleReads = 0
		let candidateReads = 0
		const withGetter = (read: () => void) =>
			Object.defineProperty({}, 'value', {
				enumerable: true,
				get() {
					read()
					return 'x'
				}
			})
		expect(
			candidate.FromSync(
				withGetter(() => candidateReads++),
				'query'
			)
		).toEqual(
			oracle.FromSync(
				withGetter(() => oracleReads++),
				'query'
			)
		)
		expect(candidateReads).toBe(oracleReads)
	})

	it('falls back for Proxy inputs', () => {
		const schema = t.Object({ value: t.String() }, { maxProperties: 1 })
		const oracle: any = new RouteValidator(
			{ query: schema },
			{ normalize: true }
		).query
		const candidate: any = new RouteValidator(
			{ query: schema },
			{ normalize: true, validationPlan }
		).query
		const input = () => {
			let reads = 0
			return new Proxy(
				{ value: 'x' },
				{
					get(target, key, receiver) {
						if (key === 'value') return ++reads === 1 ? 'x' : 1
						return Reflect.get(target, key, receiver)
					}
				}
			)
		}

		expect(candidate.FromSync(input(), 'query')).toEqual(
			oracle.FromSync(input(), 'query')
		)
	})

	it('counts non-enumerable own properties like the oracle', () => {
		const value = Object.defineProperty({ value: 'x' }, 'extra', {
			value: true,
			enumerable: false
		})

		for (const schema of [
			t.Object({ value: t.String() }, { additionalProperties: false }),
			t.Object({ value: t.String() }, { maxProperties: 1 }),
			t.Object({ value: t.String() }, { minProperties: 2 })
		])
			expect(
				run(schema, value, 'encode').result === VALIDATION_FAILED
			).toBe(!Validator.create(schema)!.Check(value))
	})

	it('matches TypeBox scalar edge semantics', () => {
		for (const [schema, value] of [
			[t.String({ pattern: '\\u{1F600}' }), '😀'],
			[t.String({ pattern: '\\u{1F600}' }), 'u{1F600}'],
			[t.String({ minLength: 2 }), '😀'],
			[t.String({ maxLength: 1 }), '😀'],
			[t.Number({ multipleOf: 0.1 }), 0.3]
		] as const)
			expect(run(schema, value, 'encode').result === VALIDATION_FAILED).toBe(
				!Validator.create(schema)!.Check(value)
			)
	})

	it('fails closed for sparse and nonstandard arrays', () => {
		const value = new Array(1)
		expect(
			run(t.Array(t.Optional(t.String())), value, 'json').result
		).toBe(VALIDATION_FAILED)
		expect(run(t.Array(t.String()), new Array(1), 'json').result).toBe(
			VALIDATION_FAILED
		)

		const inherited = new Array(1)
		const prototype = [] as string[]
		prototype[0] = 'inherited'
		Object.setPrototypeOf(inherited, prototype)
		expect(
			run(t.Array(t.Optional(t.String())), inherited, 'json').result
		).toBe(VALIDATION_FAILED)

		const proxied = new Proxy(new Array(1), {
			getOwnPropertyDescriptor: (_target, key) =>
				key === '0'
					? { configurable: true, enumerable: true, value: 'fabricated' }
					: Reflect.getOwnPropertyDescriptor(_target, key),
			has: (_target, key) => key !== '0' && Reflect.has(_target, key)
		})
		expect(
			run(t.Array(t.Optional(t.String())), proxied, 'json').result
		).toBe(VALIDATION_FAILED)

		const customPrototype = new Array(1)
		Object.setPrototypeOf(customPrototype, new Proxy([], {}))
		expect(
			run(
				t.Array(t.Optional(t.String())),
				customPrototype,
				'json'
			).result
		).toBe(VALIDATION_FAILED)

		const accessor = ['x']
		Object.defineProperty(accessor, 0, {
			configurable: true,
			enumerable: true,
			get: () => 'x'
		})
		expect(run(t.Array(t.String()), accessor, 'json').result).toBe(
			VALIDATION_FAILED
		)
	})

	it('matches the oracle for supported constraints and coercions', () => {
		const schema = t.Object({
			n: t.Number({ minimum: 1, maximum: 10 }),
			i: t.Integer({ multipleOf: 2 }),
			b: t.Boolean(),
			s: t.String({ minLength: 2, maxLength: 4, pattern: '^[a-z]+$' }),
			literal: t.Literal('x'),
			ids: t.Array(t.Number(), { minItems: 1, maxItems: 3 }),
			label: t.Optional(t.String({ default: 'ok' }))
		})
		const oracle: any = new RouteValidator(
			{ query: schema },
			{ normalize: true }
		).query
		const candidate: any = new RouteValidator(
			{ query: schema },
			{ normalize: true, validationPlan }
		).query
		const inputs = [
			{
				n: '2',
				i: '4',
				b: 'true',
				s: 'ab',
				literal: 'x',
				ids: ['1', '2']
			},
			{
				n: '0',
				i: '4',
				b: 'true',
				s: 'ab',
				literal: 'x',
				ids: ['1']
			},
			{
				n: '2',
				i: '3',
				b: 'true',
				s: 'A',
				literal: 'y',
				ids: []
			}
		]

		for (const input of inputs) {
			const settle = (validator: any) => {
				try {
					return {
						ok: true,
						value: validator.FromSync(input, 'query')
					}
				} catch {
					return { ok: false }
				}
			}
			expect(settle(candidate)).toEqual(settle(oracle))
		}
	})
})
