import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { snapshotSchema, snapshotHookSchemas } from '../../src/schema-snapshot'
import { json } from '../utils'

describe('routes keep the schema registered at definition time', () => {
	for (const precompile of [false, true]) {
		const mode = `precompile: ${precompile}`

		it(`ignores later body schema mutations (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle('/', json({ name: 'salt' }))
			expect(res.status).toBe(200)
			await expect(res.json()).resolves.toEqual({ name: 'salt' })
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
			await expect(res.json()).resolves.toEqual({ ok: true })
		})

		it(`ignores later mutations to a merge guard schema (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.guard({ schema: 'merge', body: schema })
				.post('/', ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle('/', json({ name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`ignores later guard schema mutations (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.guard({ body: schema })
				.post('/', ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle('/', json({ name: 'salt' }))
			expect(res.status).toBe(200)
		})

		it(`ignores later model schema mutations (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile })
				.model('user', schema)
				.post('/', { body: 'user' }, ({ body }) => body)

			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const res = await app.handle('/', json({ name: 'salt' }))
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

			const res = await app.handle('/', json({ age: 5 }))
			expect(res.status).toBe(200)
		})

		it(`ignores mutations after the first request (${mode})`, async () => {
			const schema = t.Object({ name: t.String() })

			const app = new Elysia({ precompile }).post(
				'/',
				{ body: schema },
				({ body }) => body
			)

			const first = await app.handle('/', json({ name: 'a' }))
			expect(first.status).toBe(200)
			;(schema.properties as any).extra = t.String()
			schema.required = ['name', 'extra']

			const second = await app.handle('/', json({ name: 'b' }))
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

	it('shares one frozen snapshot between structurally identical schemas', () => {
		// the point of interning: 40k routes built from a fresh but identical
		// `t.Object` per route must converge on ONE snapshot, which is what makes
		// the validator cache's identity memos (`#metaCache`) hit after the first
		const app = new Elysia()
			.post('/a', { body: t.Object({ name: t.String() }) }, () => '')
			.post('/b', { body: t.Object({ name: t.String() }) }, () => '')
			.post('/c', { body: t.Object({ other: t.Number() }) }, () => '')

		const body = (path: string) =>
			(app.routes.find((route) => route.path === path) as any).hooks.body

		expect(body('/a')).toBe(body('/b'))
		expect(body('/a')).not.toBe(body('/c'))
	})

	it('shares a snapshot across apps', () => {
		// the intern table is process-wide, so a snapshot outlives the app that
		// minted it. It may: it holds schema data only, and every function it
		// keeps is keyed by identity, so no app-scoped closure can be crossed in
		const one = new Elysia().post(
			'/',
			{ body: t.Object({ shared: t.String() }) },
			() => ''
		)
		const two = new Elysia().post(
			'/',
			{ body: t.Object({ shared: t.String() }) },
			() => ''
		)

		expect((one.routes[0] as any).hooks.body).toBe(
			(two.routes[0] as any).hooks.body
		)
	})

	it('deep-freezes a hook snapshot so a shared node cannot be rewritten', () => {
		// sharing is only sound while nobody can mutate the shared object, and
		// `app.routes[*].hooks` hands it to user code
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ name: t.String() }) },
			() => ''
		)
		const body = (app.routes[0] as any).hooks.body

		expect(Object.isFrozen(body)).toBe(true)
		expect(Object.isFrozen(body.properties)).toBe(true)
		expect(Object.isFrozen(body.required)).toBe(true)
		expect(() => {
			body.required = ['nope']
		}).toThrow(TypeError)
	})

	it('never shares schemas holding different callbacks', () => {
		// two schemas that are structurally identical apart from an `error`
		// callback must stay apart, or app A's route would answer with app B's
		// error function. Identity keying is what guarantees it
		const errorA = () => 'a'
		const errorB = () => 'b'
		const make = (error: () => string) =>
			t.Object({ name: t.String({ error }) })

		const a = snapshotHookSchemas({ body: make(errorA) })!.body
		const b = snapshotHookSchemas({ body: make(errorB) })!.body
		const sameA = snapshotHookSchemas({ body: make(errorA) })!.body

		expect(a).not.toBe(b)
		expect(a).toBe(sameA)
	})

	it('never shares schemas whose only difference is on the prototype', () => {
		// `t.String()` and `t.Unsafe({ type: 'string' })` are byte-identical to
		// `JSON.stringify` — which is exactly what the validator cache keys on —
		// yet carry a different `~kind`. Reusing that key here would hand one
		// route the other's kind, so the snapshot fingerprint has to be finer
		const string = snapshotHookSchemas({ body: t.String() })!.body
		const unsafe = snapshotHookSchemas({
			body: t.Unsafe<string>({ type: 'string' })
		})!.body

		expect(string).not.toBe(unsafe)
		expect((string as any)['~kind']).toBe('String')
		expect((unsafe as any)['~kind']).toBeUndefined()
	})

	it('stops sharing while an AOT build captures, but still freezes', () => {
		// an AOT build must see the same object graph it would have seen without
		// the intern table — one snapshot per registration, in registration
		// order. Freezing is NOT gated: a write to a snapshot has to fail the
		// same way in both modes or the AOT suite could never catch it
		const one = t.Object({ gated: t.String() })
		const two = t.Object({ gated: t.String() })

		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'
		let a: unknown
		let b: unknown
		try {
			a = snapshotHookSchemas({ body: one })!.body
			b = snapshotHookSchemas({ body: two })!.body
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}

		expect(a).not.toBe(b)
		expect(Object.isFrozen(a as object)).toBe(true)
	})

	it('keeps .model() roots mutable so $id can still be stamped', () => {
		// `base.ts` does `value.$id ??= key` on whatever `snapshotSchema` returns.
		// A route interning the same source first must not leave `.model()` with
		// a frozen root, or registration would throw
		const source = t.Object({ name: t.String() })

		const app = new Elysia()
			.post('/', { body: source }, () => '')
			.model({ user: source })

		expect((app.models as any).user.$id).toBe('user')
		expect(Object.isFrozen((app.models as any).user)).toBe(false)
		expect(Object.isFrozen((app.routes[0] as any).hooks.body)).toBe(true)
	})

	it('keeps a model registered before its routes shared with them', () => {
		// the pre-existing contract: a source used as both a model and a hook is
		// ONE object, so the `$id` an OpenAPI document references survives
		const source = t.Object({ name: t.String() })

		const app = new Elysia()
			.model({ user: source })
			.post('/', { body: source }, () => '')

		expect((app.routes[0] as any).hooks.body).toBe((app.models as any).user)
		expect((app.routes[0] as any).hooks.body.$id).toBe('user')
	})

	it('keeps the .model() dedup quirk: one source, one $id', () => {
		const source = t.Object({ v: t.String() })
		const app = new Elysia().model({ a: source, b: source })

		expect((app.models as any).a).toBe((app.models as any).b)
		expect((app.models as any).a.$id).toBe('a')
		expect((app.models as any).b.$id).toBe('a')
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
