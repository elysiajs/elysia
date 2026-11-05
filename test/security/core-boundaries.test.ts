import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { applySchemaDefaults, getSchemaValidator } from '../../src/schema'

const formRequest = (body: FormData) =>
	new Request('http://localhost/', {
		method: 'POST',
		body
	})

describe.each([true, false])('core security boundaries (aot: %s)', (aot) => {
	for (const hook of ['derive', 'resolve'] as const)
		it(`does not copy dangerous ${hook} keys into the request context`, async () => {
			let app = new Elysia({ aot })
			const symbol = Symbol('extension')
			const extension = () => {
				const result = JSON.parse(
					'{"safe":"copied","__proto__":{"polluted":true},"constructor":"blocked","prototype":"blocked"}'
				)
				result[symbol] = 'symbol-copied'
				return result
			}

			app =
				hook === 'derive'
					? app.derive(extension)
					: app.resolve(extension)

			const response = await app
				.get('/', (context) => ({
					safe: (context as any).safe,
					symbol: (context as any)[symbol],
					polluted: (context as any).polluted ?? null,
					constructorCopied: Object.prototype.hasOwnProperty.call(
						context,
						'constructor'
					),
					prototypeCopied: Object.prototype.hasOwnProperty.call(
						context,
						'prototype'
					)
				}))
				.handle(new Request('http://localhost/'))

			expect(await response.json()).toEqual({
				safe: 'copied',
				symbol: 'symbol-copied',
				polluted: null,
				constructorCopied: false,
				prototypeCopied: false
			})
		})

	it('applies defaults when an inherited property has the same name', async () => {
		const app = new Elysia({ aot }).get(
			'/',
			({ headers, query }) => ({
				header: (headers as any).toString,
				query: (query as any).valueOf
			}),
			{
				headers: t.Object({
					toString: t.String({ default: 'header-default' })
				}),
				query: t.Object({
					valueOf: t.String({ default: 'query-default' })
				})
			}
		)

		const response = await app.handle(new Request('http://localhost/'))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			header: 'header-default',
			query: 'query-default'
		})
	})

	it('writes decoded TypeBox cookie values back to the cookie jar', async () => {
		const app = new Elysia({ aot }).get(
			'/',
			({ cookie: { timestamp } }) => timestamp.value instanceof Date,
			{
				cookie: t.Cookie({
					timestamp: t
						.Transform(t.String())
						.Decode((value) => new Date(value))
						.Encode((value) => value.toISOString())
				})
			}
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				headers: {
					cookie: 'timestamp=2024-01-01T00:00:00.000Z'
				}
			})
		)

		expect(await response.text()).toBe('true')
	})

	it('runs each missing function default once', async () => {
		const calls = {
			body: 0,
			nested: 0,
			existing: 0,
			header: 0,
			params: 0,
			query: 0
		}
		const app = new Elysia({ aot }).post(
			'/item/:id',
			({ body, headers, params, query }) => ({
				body: (body as any).defaulted,
				nested: (body as any).nested.toString,
				existing: (body as any).existing,
				header: (headers as any)['x-default'],
				params: (params as any).defaulted,
				query: (query as any).defaulted
			}),
			{
				body: t.Object({
					defaulted: t.Any({
						default: () => (++calls.body, 'body')
					}),
					nested: t.Object({
						toString: t.Any({
							default: () => (++calls.nested, 'nested')
						})
					}),
					existing: t.Any({
						default: () => (++calls.existing, 'default')
					})
				}),
				headers: t.Object(
					{
						'x-default': t.Any({
							default: () => (++calls.header, 'header')
						})
					},
					{ additionalProperties: true }
				),
				params: t.Object({
					id: t.String(),
					defaulted: t.Any({
						default: () => (++calls.params, 'params')
					})
				}),
				query: t.Object({
					defaulted: t.Any({
						default: () => (++calls.query, 'query')
					})
				})
			}
		)

		const response = await app.handle(
			new Request('http://localhost/item/id', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ nested: {}, existing: 'existing' })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			body: 'body',
			nested: 'nested',
			existing: 'existing',
			header: 'header',
			params: 'params',
			query: 'query'
		})
		expect(calls).toEqual({
			body: 1,
			nested: 1,
			existing: 0,
			header: 1,
			params: 1,
			query: 1
		})
	})

	it('preserves an explicit own prototype value', async () => {
		let calls = 0
		const input = { toString: Object.prototype.toString }
		const app = new Elysia({ aot }).post(
			'/',
			({ body }) =>
				(body as any).toString === Object.prototype.toString,
			{
				parse: () => input,
				body: t.Object({
					toString: t.Any({ default: () => ++calls })
				})
			}
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'custom' },
				body: 'body'
			})
		)

		expect(await response.text()).toBe('true')
		expect(calls).toBe(0)
	})

	it('installs prototype-named defaults as own properties recursively', async () => {
		const defaults = {
			toString: t.Any({ default: false }),
			constructor: t.Any({ default: false }),
			['__proto__']: t.Any({ default: false })
		}
		const app = new Elysia({ aot }).post(
			'/item/:id',
			({ body, headers, params, query }) => {
				const nested = (body as any).nested
				const nestedHeader = (headers as any).nested
				const nestedParams = (params as any).nested
				const nestedQuery = (query as any).nested
				return {
					body: [(body as any).toString, (body as any).constructor, (body as any).__proto__],
					nested: [nested.toString, nested.constructor, nested.__proto__],
					header: [(headers as any).toString, (headers as any).constructor, (headers as any).__proto__],
					nestedHeader: [nestedHeader.toString, nestedHeader.constructor, nestedHeader.__proto__],
					params: [(params as any).toString, (params as any).constructor, (params as any).__proto__],
					nestedParams: [nestedParams.toString, nestedParams.constructor, nestedParams.__proto__],
					query: [(query as any).toString, (query as any).constructor, (query as any).__proto__],
					nestedQuery: [nestedQuery.toString, nestedQuery.constructor, nestedQuery.__proto__],
					normal: (body as any).normal,
					own: [body, nested, headers, nestedHeader, params, nestedParams, query, nestedQuery].every((value) =>
						['toString', 'constructor', '__proto__'].every((key) =>
							Object.prototype.hasOwnProperty.call(value, key)
						)
					)
				}
			},
			{
				body: t.Object({
					...defaults,
					nested: t.Object(defaults),
					normal: t.String({ default: 'default' })
				}),
				headers: t.Object(
					{ ...defaults, nested: t.Object(defaults, { default: {} }) },
					{ additionalProperties: true }
				),
				params: t.Object({
					...defaults,
					id: t.String(),
					nested: t.Object(defaults, { default: {} })
				}),
				query: t.Object({
					...defaults,
					nested: t.Object(defaults, { default: {} })
				})
			}
		)

		const response = await app.handle(
			new Request('http://localhost/item/value', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ nested: {}, normal: 'provided' })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			body: [false, false, false],
			nested: [false, false, false],
			header: [false, false, false],
			nestedHeader: [false, false, false],
			params: [false, false, false],
			nestedParams: [false, false, false],
			query: [false, false, false],
			nestedQuery: [false, false, false],
			normal: 'provided',
			own: true
		})
	})

	it('preserves compound TypeBox default behavior', async () => {
		const app = new Elysia({ aot }).post('/', ({ body }) => body, {
			body: t.Object({
				intersect: t.Intersect([
					t.Object({ left: t.String({ default: 'left' }) }),
					t.Object({ right: t.String({ default: 'right' }) })
				]),
				union: t.Union([
					t.Object({ selected: t.Literal('first', { default: 'first' }) }),
					t.Object({ selected: t.Literal('second', { default: 'second' }) })
				]),
				tuple: t.Tuple([t.String({ default: 'tuple' })], {
					default: []
				}),
				record: t.Record(t.String(), t.String({ default: 'record' }), {
					default: { key: undefined }
				})
			})
		})

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ intersect: {}, union: {} })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			intersect: { left: 'left', right: 'right' },
			union: { selected: 'first' },
			tuple: ['tuple'],
			record: { key: 'record' }
		})
	})

	it('parses normal nested FormData fields', async () => {
		const app = new Elysia({ aot }).post('/', ({ body }) => body)
		const form = new FormData()
		form.set('user.profile.name', 'Aru')

		const response = await app.handle(formRequest(form))

		expect(await response.json()).toEqual({
			user: { profile: { name: 'Aru' } }
		})
	})

	it('ignores FormData paths beyond the nesting limit', async () => {
		const app = new Elysia({ aot }).post('/', ({ body }) => body)
		const accepted = new FormData()
		accepted.set(`${'level.'.repeat(31)}value`, 'accepted')
		const rejected = new FormData()
		rejected.set(`${'level.'.repeat(32)}value`, 'rejected')

		const [atLimit, overLimit] = await Promise.all([
			app
				.handle(formRequest(accepted))
				.then((response) => response.json()),
			app
				.handle(formRequest(rejected))
				.then((response) => response.json())
		])

		let value = atLimit as any
		for (let index = 0; index < 31; index++) value = value.level
		expect(value.value).toBe('accepted')
		expect(overLimit).toEqual({})
	})

	it('bounds FormData array indices and total constructed paths', async () => {
		const app = new Elysia({ aot }).post('/', ({ body }) => ({
			atLimit: (body as any).items?.length ?? 0,
			overLimit: (body as any).overflow?.length ?? 0,
			keys: Object.keys(body as object).length
		}))
		const form = new FormData()
		form.set('items[10000].name', 'accepted')
		form.set('overflow[10001].name', 'rejected')
		form.set(`huge[${'9'.repeat(400)}].name`, 'rejected')
		for (let index = 0; index < 6000; index++)
			form.set(`entry${index}.value`, String(index))

		const response = await app.handle(formRequest(form))
		const value = (await response.json()) as any

		expect(value.atLimit).toBe(10001)
		expect(value.overLimit).toBe(0)
		expect(value.keys).toBeLessThanOrEqual(5001)
	})
})

it('runs direct function defaults once and skips existing values', () => {
	const calls = { value: 0, nested: 0, existing: 0 }
	const validator = getSchemaValidator(
		t.Object({
			value: t.Number({ default: () => ++calls.value }),
			nested: t.Object({
				toString: t.Any({ default: () => ++calls.nested })
			}),
			existing: t.String({
				default: () => (++calls.existing, 'default')
			})
		})
	)!

	const value = applySchemaDefaults(validator, {
		nested: {},
		existing: 'existing'
	}) as any

	expect(value.value).toBe(1)
	expect(value.nested.toString).toBe(1)
	expect(value.existing).toBe('existing')
	expect(calls).toEqual({ value: 1, nested: 1, existing: 0 })
})

it('restores partially substituted defaults when a descriptor rejects changes', () => {
	const firstDefault = () => 1
	const lockedDefault = () => 2
	const first = t.Number({ default: firstDefault })
	const locked = t.Number({ default: lockedDefault })
	Object.defineProperty(locked, 'default', {
		value: lockedDefault,
		enumerable: true,
		configurable: false,
		writable: false
	})
	const checker = {
		schema: t.Object({ first, locked })
	} as any

	expect(() => applySchemaDefaults(checker, {})).toThrow()
	expect(first.default).toBe(firstDefault)
	expect(locked.default).toBe(lockedDefault)
})

it('only runs function defaults from the selected union branch', () => {
	const calls = { x: 0, y: 0 }
	const validator = getSchemaValidator(
		t.Union([
			t.Object({
				kind: t.Literal('a'),
				x: t.Number({ default: () => ++calls.x })
			}),
			t.Object({
				kind: t.Literal('b'),
				y: t.Number({ default: () => ++calls.y })
			})
		])
	)!

	expect(applySchemaDefaults(validator, { kind: 'a' })).toEqual({
		kind: 'a',
		x: 1
	})
	expect(calls).toEqual({ x: 1, y: 0 })

	calls.x = 0
	calls.y = 0
	expect(applySchemaDefaults(validator, { kind: 'b' })).toEqual({
		kind: 'b',
		y: 1
	})
	expect(calls).toEqual({ x: 0, y: 1 })
})

it('handles reused function-default schemas without overwriting state', () => {
	const calls = { missingFirst: 0, existingFirst: 0 }
	const missingFirst = t.Number({ default: () => ++calls.missingFirst })
	const existingFirst = t.Number({ default: () => ++calls.existingFirst })
	const validator = getSchemaValidator(
		t.Object({
			missingA: missingFirst,
			existingA: missingFirst,
			existingB: existingFirst,
			missingB: existingFirst
		})
	)!

	expect(
		applySchemaDefaults(validator, { existingA: 7, existingB: 8 })
	).toEqual({
		missingA: 1,
		existingA: 7,
		existingB: 8,
		missingB: 1
	})
	expect(calls).toEqual({ missingFirst: 1, existingFirst: 1 })
})

it('preserves explicit own prototype values', () => {
	let calls = 0
	const validator = getSchemaValidator(
		t.Object({
			toString: t.Any({ default: () => ++calls }),
			constructor: t.Any({ default: () => ++calls })
		})
	)!
	const input = {
		toString: Object.prototype.toString,
		constructor: Object.prototype.constructor
	}

	const value = applySchemaDefaults(validator, input) as any

	expect(value.toString).toBe(Object.prototype.toString)
	expect(value.constructor).toBe(Object.prototype.constructor)
	expect(calls).toBe(0)
})

it('applies own-property-safe object body defaults in AOT mode', async () => {
	const app = new Elysia().post('/', ({ body }) => body, {
		body: t.Object({
			toString: t.String({ default: 'body-default' })
		})
	})

	const response = await app.handle(
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		})
	)

	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ toString: 'body-default' })
})
