import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../src'
import { snapshotSchema, snapshotHookSchemas } from '../src/schema-snapshot'

const post = (path: string, body: unknown) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

describe('schema snapshot, mutation hazard', () => {
	for (const precompile of [false, true]) {
		const label = precompile ? 'precompile' : 'jit'

		it(`body schema mutation after registration has no effect (${label})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			// mutate the ORIGINAL object before first request: tighten to require
			// an extra property. If the route used the live reference, `{name}`
			// alone would now 422.
			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ name: 'salt' })
		})

		it(`query schema mutation after registration has no effect (${label})`, async () => {
			const schema = t.Object({ q: t.String() })

			const app = new Elysia({ precompile }).get(
				'/',
				{ query: schema },
				({ query }) => query
			)

			;(schema.properties as any).required = t.String()
			schema.required = ['q', 'required']

			const res = await app.handle(
				new Request('http://localhost/?q=hello')
			)
			expect(res.status).toBe(200)
		})

		it(`response schema mutation after registration has no effect (${label})`, async () => {
			// response schema strips unknown keys; mutating it to add a required
			// field afterwards must not cause the handler's value to 422.
			const schema = t.Object({ ok: t.Boolean() })

			const app = new Elysia({ precompile }).get(
				'/',
				{ response: schema },
				() => ({ ok: true })
			)

			;(schema.properties as any).mandatory = t.String()
			schema.required = ['ok', 'mandatory']

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ ok: true })
		})

		it(`standalone schemas-array entry mutation after registration has no effect (${label})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.guard({ schema: 'standalone', body: schema })
				.post('/', ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`guard() schema mutation after registration has no effect (${label})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.guard({ body: schema })
				.post('/', ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`.model() schema mutation after registration has no effect (${label})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.model('user', schema)
				.post('/', { body: 'user' }, ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`nested-constraint mutation after registration has no effect (${label})`, async () => {
			// deep mutation: change a leaf constraint after registration.
			const schema = t.Object({ age: t.Number({ minimum: 0 }) })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			// after registration, forbid the value we're about to send
			;(schema.properties.age as any).minimum = 1000

			const res = await app.handle(post('/', { age: 5 }))
			expect(res.status).toBe(200)
		})

		it(`mutation AFTER first request also has no effect (${label})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			const first = await app.handle(post('/', { name: 'a' }))
			expect(first.status).toBe(200)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const second = await app.handle(post('/', { name: 'b' }))
			expect(second.status).toBe(200)
		})
	}
})

describe('B5 schema snapshot — helper semantics', () => {
	it('deep-clones on first sighting, preserving ~kind and type', () => {
		const schema = t.Object({ a: t.String() })
		const snap = snapshotSchema(schema)

		expect(snap).not.toBe(schema)
		expect('~kind' in (snap as object)).toBe(true)
		expect((snap as any).type).toBe('object')
	})

	it('identity dedup: same original yields the same snapshot', () => {
		const schema = t.Object({ a: t.String() })

		const a = snapshotSchema(schema)
		const b = snapshotSchema(schema)
		expect(a).toBe(b)
	})

	it('one schema reused across two routes stays a single object', () => {
		const shared = t.Object({ a: t.String() })

		const app = new Elysia()
			.post('/one', { body: shared }, ({ body }) => body)
			.post('/two', { body: shared }, ({ body }) => body)

		const routes = app.routes
		const one = (routes.find((r) => r.path === '/one') as any)?.hooks
			?.body
		const two = (routes.find((r) => r.path === '/two') as any)?.hooks
			?.body

		expect(one).toBe(two)
		expect(one).not.toBe(shared)
	})

	it('idempotent: feeding a snapshot back returns it unchanged', () => {
		const schema = t.Object({ a: t.String() })
		const snap = snapshotSchema(schema)

		expect(snapshotSchema(snap)).toBe(snap)
	})

	it('Standard Schema objects pass through by reference', () => {
		const std = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) => ({ value })
			}
		}

		expect(snapshotSchema(std)).toBe(std)
	})

	it('model-ref strings, undefined and null pass through', () => {
		expect(snapshotSchema('user')).toBe('user')
		expect(snapshotSchema(undefined)).toBe(undefined)
		expect(snapshotSchema(null)).toBe(null)
	})

	it('preserves codec decode/encode function references', () => {
		const decode = (v: string) => v
		const encode = (v: string) => v
		const codec = t.Codec(t.String()).Decode(decode).Encode(encode)

		const snap = snapshotSchema(codec) as any
		expect(snap['~codec'].decode).toBe(decode)
		expect(snap['~codec'].encode).toBe(encode)
	})

	it('keeps non-schema instances (Date, RegExp) by reference', () => {
		const date = new Date()
		const re = /x/g
		const wrapper = snapshotSchema({ a: date, b: re }) as any

		expect(wrapper.a).toBe(date)
		expect(wrapper.b).toBe(re)
	})

	it('does not mutate the caller hook object', () => {
		const schema = t.Object({ a: t.String() })
		const hook = { body: schema, beforeHandle: () => {} }

		const snapped = snapshotHookSchemas(hook)

		// caller's hook untouched
		expect(hook.body).toBe(schema)
		// snapshot is a distinct object with a distinct body
		expect(snapped).not.toBe(hook)
		expect(snapped!.body).not.toBe(schema)
		// non-schema slots carried by reference
		expect(snapped!.beforeHandle).toBe(hook.beforeHandle)
	})

	it('returns the original hook unchanged when it carries no schema', () => {
		const hook = { beforeHandle: () => {} }
		expect(snapshotHookSchemas(hook)).toBe(hook)
	})

	it('does not corrupt a schema whose property key is __proto__', () => {
		const inner = t.String()
		const props = Object.defineProperty({}, '__proto__', {
			value: inner,
			enumerable: true,
			configurable: true,
			writable: true
		})
		const schema = t.Object(props as any)

		const snap = snapshotSchema(schema) as any
		expect(Object.getPrototypeOf(snap.properties)).toBe(Object.prototype)
		expect(Object.hasOwn(snap.properties, '__proto__')).toBe(true)
	})
})
