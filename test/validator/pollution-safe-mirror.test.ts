import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'

const schema = (
	key = '__proto__',
	property: any = t.Object({ polluted: t.String() }),
	properties: Record<string, any> = {}
) =>
	t.Object(
		Object.defineProperty(properties, key, {
			value: property,
			enumerable: true
		}) as any
	)

const body = (key = '__proto__', value: any = { polluted: 'yes' }) =>
	Object.defineProperty({}, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	})

const expectSafePrototype = (value: any, key = '__proto__') => {
	expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
	expect(Object.hasOwn(value, key)).toBe(true)
	expect(value.polluted).toBeUndefined()
}

describe('pollution-safe mirror', () => {
	it('keeps dangerous schema keys as own data in the sync validator path', () => {
		for (const key of ['__proto__', 'constructor', 'prototype']) {
			const normalized = new TypeBoxValidator(schema(key)).FromSync(
				body(key)
			)

			expectSafePrototype(normalized, key)
		}
	})

	it('keeps an own __proto__ schema key safe in the async validator path', async () => {
		const check = () => true
		;(check as any)['~elyAsyncRefine'] = true
		const validator = new TypeBoxValidator(
			schema('__proto__', undefined, {
				gate: t.Refine(t.String(), check)
			})
		)

		expect(validator.isAsync).toBe(true)
		const normalized = await validator.From(
			Object.assign(body(), { gate: 'ok' }) as any
		)
		expectSafePrototype(normalized)
	})

	it('falls back safely when an own __proto__ subtree has defaults', () => {
		const validator = new TypeBoxValidator(
			schema(
				'__proto__',
				t.Object({ polluted: t.String({ default: 'default' }) })
			)
		)

		expect(validator.hasDefault).toBe(true)
		expect(validator.precomputeSafe).toBe(false)
		const normalized = validator.FromSync(body('__proto__', {}) as any)
		expectSafePrototype(normalized)
		expect((normalized as any).__proto__).toEqual({ polluted: 'default' })
	})

	it('keeps request body normalization prototype-safe', async () => {
		const app = new Elysia().post('/', { body: schema() }, ({ body }) => ({
			prototype: Object.getPrototypeOf(body) === Object.prototype,
			own: Object.hasOwn(body as object, '__proto__'),
			polluted: (body as any).polluted
		}))

		const response = await app
			.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body())
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({ prototype: true, own: true })
	})
})
