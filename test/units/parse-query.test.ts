import { describe, expect, it } from 'bun:test'

import { t } from '../../src'
import {
	validationPlan,
	ValidationPlanValidator
} from '../../src/experimental/validation-plan'
import {
	createQueryPlan,
	getQueryParseChannels,
	parseQueryFromURL
} from '../../src/parse-query'
import { RouteValidator } from '../../src/validator/route'
import { createValidationPlan } from '../../src/validator/validation-plan'
import {
	VALIDATION_PLAN_FUSED_QUERY,
	VALIDATION_PLAN_ORACLE
} from '../../src/type/constants'

const parse = (url: string) => parseQueryFromURL(url, url.indexOf('?'))

describe('parseQueryFromURL', () => {
	it('parses a simple query', () => {
		expect(parse('http://x.ab/path?a=1&b=2')).toEqual({ a: '1', b: '2' })
	})

	it('decodes percent-encoded and plus values', () => {
		expect(parse('http://x.ab/path?q=hello+world&e=a%20b')).toEqual({
			q: 'hello world',
			e: 'a b'
		})
	})

	it('ignores delimiters in the path before the query', () => {
		expect(parse('http://x.ab/files/a&b?name=value&x=1')).toEqual({
			name: 'value',
			x: '1'
		})

		expect(parse('http://x.ab/p+a%20th?q=hello+world')).toEqual({
			q: 'hello world'
		})

		expect(parse('http://x.ab/a=b/c?k=v')).toEqual({ k: 'v' })
	})

	it('returns empty object when there is no query string', () => {
		expect(parse('http://x.ab/no-query')).toEqual({})
		expect(parse('http://x.ab/trailing?')).toEqual({})
	})

	it('does not throw on malformed bracketed array+object input', () => {
		const url = 'http://x.ab/p?key=[not-json'
		const cfg = { key: 1 as const }

		expect(() =>
			parseQueryFromURL(url, url.indexOf('?'), cfg, cfg)
		).not.toThrow()

		const ok = 'http://x.ab/p?key=[1,2]'
		expect(
			parseQueryFromURL(ok, ok.indexOf('?'), cfg, cfg).key as unknown
		).toEqual([1, 2])
	})

	it('does not treat an unclosed bracket value as an array', () => {
		const cfg = { role: 1 as const }
		const url = 'http://x.ab/p?role=[adminX'

		expect(parseQueryFromURL(url, url.indexOf('?'), cfg).role).toEqual([
			'[adminX'
		])

		const ok = 'http://x.ab/p?role=[admin]'
		expect(parseQueryFromURL(ok, ok.indexOf('?'), cfg).role).toEqual([
			'admin'
		])

		const plain = 'http://x.ab/p?role=[adminX'
		expect(parseQueryFromURL(plain, plain.indexOf('?')).role).toBe(
			'[adminX'
		)
	})

	it('preserves repeated bracketed array query order', () => {
		const cfg = { key: 1 as const }

		expect(
			parseQueryFromURL(
				'http://x.ab/p?key=[1,2]&key=[3,4]',
				'http://x.ab/p'.length,
				cfg
			).key as unknown
		).toEqual(['1', '2', '3', '4'])
	})
})

describe('QueryPlan', () => {
	it('freezes schema-derived parse channels without retaining a cache', () => {
		const schema = t.Object({
			ids: t.Array(t.String()),
			filter: t.ObjectString({ name: t.String() })
		})
		const plan = createQueryPlan(schema)

		expect(createQueryPlan(schema)).not.toBe(plan)
		expect(Object.isFrozen(plan)).toBe(true)
		expect(Object.isFrozen(plan.array)).toBe(true)
		expect(Object.isFrozen(plan.object)).toBe(true)
		expect(Object.getPrototypeOf(plan.array!)).toBeNull()
		expect(Object.getPrototypeOf(plan.object!)).toBeNull()

		const url =
			'http://x.ab/p?ids=a,b&ids=[c,d]&filter=' +
			encodeURIComponent('{"name":"elysia"}')
		expect(
			plan.parse(url, url.indexOf('?'), plan.array, plan.object)
		).toEqual({
			ids: ['a', 'b', 'c', 'd'],
			filter: { name: 'elysia' }
		})
	})

	it('fuses scalar parsing, duplicate resolution, defaults, and validation', () => {
		const validator = new RouteValidator(
			{
				query: t.Object({
					name: t.String(),
					page: t.Number(),
					limit: t.Integer(),
					active: t.Boolean(),
					fallback: t.Number({ default: '3' as any })
				})
			},
			{ validationPlan }
		)
		const plan = validator.queryPlan!
		const url =
			'http://x.ab/p?name=hello+world&page=bad&page=2&limit=10&active=false&ignored=yes'

		expect(plan.fused).toBe(true)
		let oracleCalls = 0
		const shouldNotCall = {
			From() {
				oracleCalls++
				throw new Error('valid fused query reached the oracle')
			},
			[VALIDATION_PLAN_ORACLE]() {
				oracleCalls++
				throw new Error('valid fused query reached the oracle')
			}
		}
		const parsed = plan.fromURL!(url, url.indexOf('?'))
		expect(Object.getPrototypeOf(parsed)).toBeNull()
		expect(plan.validate!(parsed, shouldNotCall)).toEqual({
			name: 'hello world',
			page: 2,
			limit: 10,
			active: false,
			fallback: 3
		})
		expect(
			Object.keys(
				plan.validate!(
					plan.fromURL!(
						'http://x.ab/p?active=true&limit=2&page=1&name=x',
						'http://x.ab/p'.length
					),
					shouldNotCall
				)
			)
		).toEqual(['name', 'page', 'limit', 'active', 'fallback'])
		expect(oracleCalls).toBe(0)

		const leadingDefault = new RouteValidator(
			{
				query: t.Object({
					fallback: t.Number({ default: '3' as any }),
					page: t.Number()
				})
			},
			{ validationPlan }
		)
		const leadingPlan = leadingDefault.queryPlan!
		const leadingUrl = 'http://x.ab/p?page=1'
		expect(
			leadingPlan.validate!(
				leadingPlan.fromURL!(leadingUrl, leadingUrl.indexOf('?')),
				shouldNotCall
			)
		).toEqual({ fallback: 3, page: 1 })
		expect(oracleCalls).toBe(0)

		const invalidUrl =
			'http://x.ab/p?name=x&page=bad&limit=2&active=true'
		const invalid = plan.fromURL!(invalidUrl, invalidUrl.indexOf('?'))
		try {
			plan.validate!(invalid, validator.query as any)
			expect.unreachable()
		} catch (error: any) {
			expect(Reflect.ownKeys(error.value)).toEqual([
				'fallback',
				'name',
				'page',
				'limit',
				'active'
			])
		}
	})

	it('reuses one frozen scalar plan per cached validator', () => {
		const app = {}
		const shared = t.Object({ page: t.Number() })
		const first = new RouteValidator(
			{ query: shared },
			{ app, validationPlan }
		)
		const second = new RouteValidator(
			{ query: shared },
			{ app, validationPlan }
		)
		const unique = new RouteValidator(
			{ query: t.Object({ page: t.Number() }) },
			{ app, validationPlan }
		)

		expect(first.query).toBe(second.query)
		expect(first.queryPlan).toBe(second.queryPlan)
		expect(Object.isFrozen(first.queryPlan)).toBe(true)
		expect(unique.queryPlan).not.toBe(first.queryPlan)
	})

	it('builds the scalar plan before generic channel collection', () => {
		const schema = t.Object({ page: t.Number() })
		const validator = new ValidationPlanValidator(
			schema,
			createValidationPlan(schema, 'string')!,
			undefined,
			true
		)
		const trap = Object.create(validator.schema)
		Object.defineProperty(trap, 'properties', {
			get() {
				throw new Error('generic query channels were collected')
			}
		})

		expect(createQueryPlan(trap, validator, true).fused).toBe(true)
	})

	it('fails closed for unsupported additional values', () => {
		const closed = new RouteValidator(
			{
				query: t.Object(
					{ page: t.Number() },
					{ additionalProperties: false }
				)
			},
			{ validationPlan }
		)
		const open = new RouteValidator(
			{
				query: t.Object(
					{ page: t.Number() },
					{ additionalProperties: true }
				)
			},
			{ validationPlan }
		)

		expect(closed.queryPlan?.fused).toBe(true)
		expect(open.queryPlan?.fused).toBeUndefined()
	})

	it('falls back instead of admitting numeric strings that overflow', () => {
		const overflow = '9'.repeat(400)
		for (const value of [t.Number(), t.Integer()]) {
			const validator = new RouteValidator(
				{ query: t.Object({ value }) },
				{ validationPlan }
			)
			const plan = validator.queryPlan!
			const url = `http://x.ab/p?value=${overflow}`
			const query = plan.fromURL!(url, url.indexOf('?'))
			let oracleValue: unknown

			expect(() =>
				plan.validate!(query, {
					[VALIDATION_PLAN_ORACLE](value: unknown) {
						oracleValue = value
						throw new Error('oracle fallback')
					}
				} as any)
			).toThrow()
			expect(oracleValue).toEqual({ value: overflow })
		}
	})

	it('admits only the built-in synchronous plan and safe property names', () => {
		const schema = t.Object({ page: t.Number() })
		const delegated = { ...validationPlan }
		const builtIn = new RouteValidator(
			{ query: schema },
			{ validationPlan }
		).query as any
		const fake = {
			plan: builtIn.plan,
			isAsync: false,
			mayReturnPromise: false,
			From: builtIn.From.bind(builtIn)
		}

		expect(createQueryPlan(schema, fake, true).fused).toBeUndefined()
		expect(createQueryPlan(schema, builtIn).fused).toBeUndefined()
		expect(createQueryPlan(schema, builtIn, true).fused).toBe(true)
		expect(
			new RouteValidator(
				{ query: schema },
				{ validationPlan: delegated }
			).queryPlan?.fused
		).toBeUndefined()
		expect(
			createQueryPlan(schema, {
				...fake,
				[VALIDATION_PLAN_FUSED_QUERY]: true,
				isAsync: true
			}, true).fused
		).toBeUndefined()

		const originalFrom = builtIn.From
		builtIn.From = function (value: unknown, type?: string) {
			return {
				...originalFrom.call(this, value, type),
				custom: true
			}
		}
		expect(createQueryPlan(schema, builtIn, true).fused).toBeUndefined()

		for (const key of ['__proto__', 'constructor', 'prototype']) {
			const properties = Object.create(null)
			properties[key] = t.String()
			const route = new RouteValidator(
				{ query: t.Object(properties) },
				{ validationPlan }
			)
			expect(route.queryPlan?.fused).toBeUndefined()
		}
	})

	it('rejects fusion after built-in validator prototypes are replaced', () => {
		const original = ValidationPlanValidator.prototype.From
		try {
			ValidationPlanValidator.prototype.From = function (
				value: unknown,
				type?: string
			) {
				return original.call(this, value, type)
			}
			const route = new RouteValidator(
				{ query: t.Object({ page: t.Number() }) },
				{ validationPlan }
			)
			expect(route.queryPlan?.fused).toBeUndefined()
		} finally {
			ValidationPlanValidator.prototype.From = original
		}
	})

	it('keeps generic and malformed-input behavior unchanged', () => {
		const plan = createQueryPlan(undefined)
		const url =
			'http://x.ab/p?key=first&key=last&bad=%E0%A4%A&__proto__=safe'
		const parsed = plan.parse(
			url,
			url.indexOf('?'),
			plan.array,
			plan.object
		)

		expect(Object.getPrototypeOf(parsed)).toBeNull()
		expect(parsed.key).toBe('last')
		expect(parsed.bad).toBe('%E0%A4%A')
		expect(parsed.__proto__).toBe('safe')
	})

	it('fails closed instead of recursing forever on cyclic schemas', () => {
		const cyclic: any = {}
		cyclic.anyOf = [cyclic]

		expect(() => createQueryPlan(cyclic)).not.toThrow()
		expect(createQueryPlan(cyclic).array).toBeUndefined()
		expect(createQueryPlan(cyclic).object).toBeUndefined()
	})

	it('does not retain candidate state in the legacy validator', () => {
		const route = { query: t.Object({ id: t.Array(t.String()) }) }

		expect(new RouteValidator(route).queryPlan).toBeUndefined()
		expect(
			new RouteValidator(route, { validationPlan }).queryPlan
		).toBeDefined()
	})

	it('keeps the legacy union parser independent from QueryPlan', () => {
		const schema = {
			type: 'object',
			properties: {
				value: {
					anyOf: [
						{ type: 'string' },
						{
							type: 'object',
							properties: { name: { type: 'string' } }
						}
					]
				}
			}
		}
		const plan = createQueryPlan(schema)
		const legacy = getQueryParseChannels(schema)
		const url =
			'http://x.ab/p?value=' + encodeURIComponent('{"name":"elysia"}')

		expect(
			parseQueryFromURL(
				url,
				url.indexOf('?'),
				legacy?.array,
				legacy?.object
			).value
		).toBe('{"name":"elysia"}')
		expect(
			plan.parse(url, url.indexOf('?'), plan.array, plan.object).value
		).toBe('{"name":"elysia"}')
	})
})
