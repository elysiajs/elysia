import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { extractDeriveKeys } from '../../src/compile/handler/utils'
import { TypeBoxValidator } from '../../src/type/validator'
import { Validator } from '../../src/validator'

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

describe('prototype-safe normalization', () => {
	it('keeps __proto__, constructor, and prototype as own data properties', () => {
		for (const key of ['__proto__', 'constructor', 'prototype']) {
			const normalized = new TypeBoxValidator(schema(key)).FromSync(
				body(key)
			)

			expectSafePrototype(normalized, key)
		}
	})

	it('keeps an own __proto__ property on the async validation path', async () => {
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

	it('applies defaults inside an own __proto__ property without pollution', () => {
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

	it('normalizes request bodies without changing their prototype', async () => {
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

// A wire-supplied prototype is not global `Object.prototype` pollution, it is
// worse-behaved: the injected members are invisible to `Object.keys`,
// `Object.hasOwn` and to re-validation, yet every read resolves through them.
// That makes it an auth-bypass primitive — a guard reading `body.isAdmin` or
// `ctx.user.role` is answered by the attacker — and, once the prototype is
// attacker-chosen, a way to forge the framework's own `constructor.name`
// response dispatch. Each case below is a distinct way to hand the attacker
// that prototype; the leak assertion is the point, not the shape.
describe('attacker-supplied prototypes', () => {
	// A JSON-forged prototype carries a plain object as its `constructor`;
	// only a real class prototype's is callable. Without that check a handler
	// merging untrusted input with `Object.assign` lets the request pick the
	// response status AND arbitrary response headers.
	const forgedStatus =
		'{"__proto__":{"constructor":{"name":"ElysiaStatus"},"code":418,' +
		'"headers":{"set-cookie":"session=attacker; Path=/",' +
		'"location":"https://evil.test"},"response":"OWNED"}}'

	const post = (app: Elysia, body: string) =>
		app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			})
		)

	it('cannot forge a response tag through a hijacked prototype', async () => {
		// `Object.assign` assigns, so the body's own `__proto__` reparents the
		// merged object — plain handler code, no Elysia feature involved.
		// The compact lane (no `set`) and the set-aware lane dispatch through
		// the same tag, so both are asserted.
		const compact = new Elysia().post('/', ({ body }) =>
			Object.assign({ ok: true }, body as object)
		)

		const withSet = new Elysia().post('/', ({ body, set }) => {
			set.headers['x-route'] = 'set-lane'
			return Object.assign({ ok: true }, body as object)
		})

		for (const app of [compact, withSet]) {
			const response = await post(app, forgedStatus)

			expect(response.status).toBe(200)
			expect(response.headers.get('set-cookie')).toBeNull()
			expect(response.headers.get('location')).toBeNull()
			expect(await response.json()).toEqual({ ok: true })
		}
	})

	it('still dispatches a genuine status through the same tag', async () => {
		// The guard must reject forged tags without disabling name-based
		// dispatch, which is what keeps a dual-installed Elysia working.
		const app = new Elysia().post('/', ({ status }) =>
			status(418, { ok: true })
		)

		const response = await post(app, '{}')

		expect(response.status).toBe(418)
		expect(await response.json()).toEqual({ ok: true })
	})

	// `MultiValidator.#merge` folds member outputs with `Object.assign`, so a
	// member that returns the request by reference (any passthrough Standard
	// Schema under `schema: 'merge'`) reparents the snapshot the handler is
	// handed. `isAdmin` must stay unreachable while `__proto__` survives as
	// inert data — the round-trip contract `form()` already pins.
	const passthrough = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value: unknown) => ({ value })
		}
	} as any

	const named = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value: any) => ({ value: { name: value?.name } })
		}
	} as any

	it('does not let a merged member reparent the validated value', async () => {
		const app = new Elysia()
			.guard({ schema: 'merge', body: passthrough })
			.post('/', { body: named }, ({ body }) => ({
				isAdmin: (body as any).isAdmin ?? null,
				prototype: Object.getPrototypeOf(body as object) ===
					Object.prototype,
				own: Object.hasOwn(body as object, '__proto__'),
				keys: Object.keys(body as object)
			}))

		const response = await post(
			app,
			'{"name":"lilith","__proto__":{"isAdmin":true}}'
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			isAdmin: null,
			prototype: true,
			own: true,
			keys: ['name', '__proto__']
		})
	})

	it('does not let a merged object member reparent an array snapshot', async () => {
		// An array snapshot only takes the `push(...result)` lane when the
		// member result is also an array; a non-array result falls through to
		// the same `Object.assign` and needs the same guard.
		const list = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => ({ value: ['first'] })
			}
		} as any

		const validator = Validator.create(list, { schemas: [passthrough] })!
		const merged: any = await validator.From!(
			JSON.parse('{"__proto__":{"isAdmin":true}}'),
			'body'
		)

		expect(Array.isArray(merged)).toBe(true)
		expect(Object.getPrototypeOf(merged)).toBe(Array.prototype)
		expect(merged.isAdmin).toBeUndefined()
	})

	// A derive that returns (or spreads) parsed input merges attacker keys into
	// the live context. Beyond injecting a `user` a resolve never granted, the
	// in-place lane clobbers `ctx.status` into a string, turning every
	// `status()` call on the route into a 500.
	it.each([
		['derive', (app: Elysia) => app.derive(({ body }: any) => body)],
		['mapDerive', (app: Elysia) => app.mapDerive(({ body }: any) => body)]
	])('does not let %s reparent the context', async (_name, attach) => {
		const app = attach(new Elysia()).post('/', (context: any) => ({
			isAdmin: context.isAdmin ?? null,
			status: typeof context.status,
			prototype: Object.getPrototypeOf(context) !== null
		}))

		const response = await post(
			app,
			'{"__proto__":{"isAdmin":true,"status":"HIJACK"},"a":1}'
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			isAdmin: null,
			status: 'function',
			prototype: true
		})
		expect(({} as any).isAdmin).toBeUndefined()
	})

	// The derives above are unscannable, so they take the guarded merge. When
	// `extractDeriveKeys` *can* read the literal, the codegen stores key by
	// key instead — and in `{ __proto__: body }` the key is prototype-setter
	// syntax, so `tmp` carries no own `__proto__` for `Object.hasOwn` to catch.
	// The store then read the inherited getter and wrote through the inherited
	// setter, reparenting the live context on the one lane the guard missed.
	it('does not let a scanned __proto__ key reparent the context', async () => {
		const derive = ({ body }: any) => ({ __proto__: body, tag: 1 }) as any

		// pins the lane: this literal is scannable, so it is the key-wise path
		expect(extractDeriveKeys(derive)).toEqual(['__proto__', 'tag'])

		const app = new Elysia().derive(derive).post('/', (context: any) => ({
			isAdmin: context.isAdmin ?? null,
			status: typeof context.status,
			// the declared sibling key must still merge
			tag: context.tag ?? null
		}))

		const response = await post(app, '{"isAdmin":true}')

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			isAdmin: null,
			status: 'function',
			tag: 1
		})
	})
})
