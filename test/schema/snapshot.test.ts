import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { snapshotSchema, snapshotHookSchemas } from '../../src/schema-snapshot'

const post = (path: string, body: unknown) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

describe('routes keep the schema registered at definition time', () => {
	for (const precompile of [undefined, true] as const) {
		const mode = precompile ? 'precompile: true' : 'default'

		it(`ignores later body schema mutations (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ name: 'salt' })
		})

		it(`ignores later query schema mutations (${mode})`, async () => {
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

		it(`ignores later response schema mutations (${mode})`, async () => {
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

		it(`ignores later mutations to a standalone guard schema (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.guard({ schema: 'standalone', body: schema })
				.post('/', ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`ignores later guard schema mutations (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.guard({ body: schema })
				.post('/', ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`ignores later model schema mutations (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.model('user', schema)
				.post('/', { body: 'user' }, ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle(post('/', { name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`ignores later nested constraint mutations (${mode})`, async () => {
			const schema = t.Object({ age: t.Number({ minimum: 0 }) })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			;(schema.properties.age as any).minimum = 1000

			const res = await app.handle(post('/', { age: 5 }))
			expect(res.status).toBe(200)
		})

		it(`ignores mutations after the first request (${mode})`, async () => {
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

describe('schema snapshot helpers', () => {
	it('clones schemas while preserving type metadata', () => {
		const schema = t.Object({ a: t.String() })
		const snap = snapshotSchema(schema)

		expect(snap).not.toBe(schema)
		expect('~kind' in (snap as object)).toBe(true)
		expect((snap as any).type).toBe('object')
	})

	it('reuses the snapshot for the same source schema', () => {
		const schema = t.Object({ a: t.String() })

		const a = snapshotSchema(schema)
		const b = snapshotSchema(schema)
		expect(a).toBe(b)
	})

	it('shares one snapshot between routes using the same source schema', () => {
		const shared = t.Object({ a: t.String() })

		const app = new Elysia()
			.post('/one', { body: shared }, ({ body }) => body)
			.post('/two', { body: shared }, ({ body }) => body)

		const routes = app.routes
		const one = (routes.find((r) => r.path === '/one') as any)?.hooks?.body
		const two = (routes.find((r) => r.path === '/two') as any)?.hooks?.body

		expect(one).toBe(two)
		expect(one).not.toBe(shared)
	})

	it('returns an existing snapshot unchanged', () => {
		const schema = t.Object({ a: t.String() })
		const snap = snapshotSchema(schema)

		expect(snapshotSchema(snap)).toBe(snap)
	})

	it('keeps Standard Schema objects by reference', () => {
		const std = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) => ({ value })
			}
		}

		expect(snapshotSchema(std)).toBe(std)
	})

	it('keeps model references, undefined, and null unchanged', () => {
		expect(snapshotSchema('user')).toBe('user')
		expect(snapshotSchema(undefined)).toBe(undefined)
		expect(snapshotSchema(null)).toBe(null)
	})

	it('preserves codec function references', () => {
		const decode = (v: string) => v
		const encode = (v: string) => v
		const codec = t.Codec(t.String()).Decode(decode).Encode(encode)

		const snap = snapshotSchema(codec) as any
		expect(snap['~codec'].decode).toBe(decode)
		expect(snap['~codec'].encode).toBe(encode)
	})

	it('keeps Date and RegExp instances by reference', () => {
		const date = new Date()
		const re = /x/g
		const wrapper = snapshotSchema({ a: date, b: re }) as any

		expect(wrapper.a).toBe(date)
		expect(wrapper.b).toBe(re)
	})

	it('copies schema slots without mutating the hook object', () => {
		const schema = t.Object({ a: t.String() })
		const hook = { body: schema, beforeHandle: () => {} }

		const snapped = snapshotHookSchemas(hook)

		expect(hook.body).toBe(schema)
		expect(snapped).not.toBe(hook)
		expect(snapped!.body).not.toBe(schema)
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
