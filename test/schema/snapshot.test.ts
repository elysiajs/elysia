import { describe, expect, it } from 'bun:test'

import { Elysia, status, t } from '../../src'
import { snapshotSchema, snapshotHookSchemas } from '../../src/schema-snapshot'
import { routeShape } from '../../src/compile/handler/route-shape'
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

	it('shares one container between equal status maps', () => {
		// read-only + frozen alone already cuts most of the per-route cost, so
		// only identity proves routes declaring the same map keep one container
		const schema = t.String()
		const other = t.String({ minLength: 1 })

		const first = snapshotHookSchemas({
			response: { 200: schema, 404: schema }
		})!.response
		const second = snapshotHookSchemas({
			response: { 200: schema, 404: schema }
		})!.response
		const differs = snapshotHookSchemas({
			response: { 200: schema, 404: other }
		})!.response

		expect(first).toBe(second)
		expect(differs).not.toBe(first)
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
		let mapA: unknown
		let mapB: unknown
		try {
			a = snapshotHookSchemas({ body: one })!.body
			b = snapshotHookSchemas({ body: two })!.body
			mapA = snapshotHookSchemas({ response: { 200: one } })!.response
			mapB = snapshotHookSchemas({ response: { 200: one } })!.response
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}

		expect(a).not.toBe(b)
		expect(Object.isFrozen(a as object)).toBe(true)

		// equal status maps stop sharing their container too, and it still freezes
		expect(mapA).not.toBe(mapB)
		expect(Object.isFrozen(mapA as object)).toBe(true)
		expect(Object.isFrozen(mapB as object)).toBe(true)
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

	it('gives each name of one source its own $id', async () => {
		// `$id` is how a `t.Ref` and OpenAPI name a model: one shared clone
		// would name `b` after `a`
		const source = t.Object({ v: t.String() })
		const app = new Elysia()
			.model({ a: source, b: source })
			.post('/', { body: t.Object({ x: t.Ref('b') }) }, () => 'ok')

		expect((app.models as any).a.$id).toBe('a')
		expect((app.models as any).b.$id).toBe('b')
		expect(source).not.toHaveProperty('$id')

		const valid = await app.handle('/', json({ x: { v: 'v' } }))
		const invalid = await app.handle('/', json({ x: { v: 1 } }))
		expect(valid.status).toBe(200)
		expect(invalid.status).toBe(422)
	})

	it('gives apps modelling one shared schema their own $id', () => {
		// a bare `t.String()` is a process-wide frozen singleton
		const shared = t.String()
		const first = new Elysia().model({ first: shared })
		const second = new Elysia().model({ second: shared })

		expect((first.models as any).first.$id).toBe('first')
		expect((second.models as any).second.$id).toBe('second')
		expect((second.models as any).second).not.toBe(
			(first.models as any).first
		)
	})

	it("keeps another app's model $id out of a route", () => {
		// a route body is only its own app's model, else every `t.String()`
		// body in the process carries whichever name modelled it first, and
		// an AOT build of it drifts when the model registers after the capture
		new Elysia().model({ elsewhere: t.String() })
		const app = new Elysia().post('/', { body: t.String() }, () => '')

		expect((app.routes[0] as any).hooks.body.$id).toBeUndefined()
	})

	it("picks a route's model from its own table, not process history", () => {
		// another app registering `b` first must not change which name this
		// app's route carries: route identity feeds the AOT replay checksum
		const shape = (app: any) =>
			routeShape(app.routes[0].hooks, app.routes[0].handler, app)
		const build = (source: any) =>
			new Elysia()
				.model({ a: source, b: source })
				.post('/', { body: source }, () => '')

		const cold = build(t.Object({ v: t.String() }))
		const warmSource = t.Object({ v: t.String() })
		new Elysia().model('b', warmSource)
		const warm = build(warmSource)

		expect((cold.routes[0] as any).hooks.body.$id).toBe('a')
		expect((warm.routes[0] as any).hooks.body.$id).toBe('a')
		expect(shape(warm)).toBe(shape(cold))
	})

	it('renames a model clone passed back to .model()', () => {
		// a generated `$id` belongs to its name: re-registered elsewhere it
		// must not travel along
		const owner = new Elysia().model('a', t.Object({ v: t.String() }))
		const renamed = new Elysia().model('b', owner.models.a)
		const mapped = new Elysia()
			.model('a', owner.models.a)
			.model(({ a }) => ({ a, c: a }))
		const foreign = new Elysia().post(
			'/',
			{ body: owner.models.a },
			() => ''
		)

		expect((renamed.models as any).b.$id).toBe('b')
		expect((mapped.models as any).a.$id).toBe('a')
		expect((mapped.models as any).c.$id).toBe('c')
		expect((foreign.routes[0] as any).hooks.body.$id).toBeUndefined()
	})

	it('keeps an app model its own when another app uses the same name', async () => {
		// a write to one app's model must not change another app's validation
		const shared = t.String()
		const first = new Elysia()
			.model('same', shared)
			.post('/', { body: 'same' }, ({ body }) => body)
		const second = new Elysia().model('same', shared)

		expect(second.models.same).not.toBe(first.models.same)
		;(second.models.same as any).type = 'number'

		const response = await first.handle('/', {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: 'hello'
		})
		expect(response.status).toBe(200)
	})

	it('lets a model clone die with its app', async () => {
		// a long-lived source (the `t.String()` singleton) must not keep
		// every app's clone, nor make a route scan every name in the process
		const singleton = t.String()
		const clones: WeakRef<object>[] = []
		;(() => {
			for (let i = 0; i < 200; i++) {
				const app = new Elysia().model('m' + i, singleton)
				clones.push(new WeakRef(app.models['m' + i] as object))
			}
		})()
		await Bun.sleep(0)
		Bun.gc(true)
		await Bun.sleep(0)
		Bun.gc(true)

		expect(clones.filter((ref) => ref.deref()).length).toBeLessThan(100)

		let reads = 0
		const models = new Proxy(Object.create(null), {
			get: () => void reads++
		})
		snapshotHookSchemas({ body: singleton }, models)
		expect(reads).toBe(0)
	})

	it('owns models a mapper edits in place', async () => {
		// a mapper returning the same table still names and clones each
		// entry, else a moved model keeps its old `$id` and a raw schema
		// stays the caller's object, open to later writes
		const moved = new Elysia().model(
			'Original',
			t.Object({ v: t.String() })
		)
		moved.model((models: any) => {
			models.Renamed = models.Original
			delete models.Original

			return models
		})

		const raw = t.Object({ v: t.String() })
		const replaced = new Elysia().model('M', t.Number())
		replaced.model((models: any) => {
			models.M = raw

			return models
		})
		replaced.post('/', { body: 'M' }, () => 'ok')

		expect((moved.models as any).Renamed.$id).toBe('Renamed')
		expect(replaced.models.M).not.toBe(raw)
		expect((replaced.models as any).M.$id).toBe('M')
		;(raw.properties.v as any) = t.Number()

		const response = await replaced.handle('/', json({ v: 'ok' }))
		expect(response.status).toBe(200)
	})

	it("keeps a nested foreign model's $id out of a route", async () => {
		// two apps' `Same` nested in one route would form a `$ref` registry
		// the route's app never declared: `t.Ref('Same')` picks either
		const one = new Elysia().model('Same', t.Object({ v: t.String() }))
		const two = new Elysia().model('Same', t.Object({ v: t.Number() }))
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					one: one.models.Same,
					two: two.models.Same
				})
			},
			() => 'ok'
		)

		const body = (app.routes[0] as any).hooks.body
		expect(body.properties.one.$id).toBeUndefined()
		expect(body.properties.two.$id).toBeUndefined()

		const valid = await app.handle(
			'/',
			json({ one: { v: 'a' }, two: { v: 1 } })
		)
		const invalid = await app.handle(
			'/',
			json({ one: { v: 1 }, two: { v: 'a' } })
		)
		expect(valid.status).toBe(200)
		expect(invalid.status).toBe(422)
	})

	it('keeps a user $id on a nested model clone', () => {
		const owner = new Elysia().model(
			'A',
			t.Object({ v: t.String() }, { $id: 'Own' })
		)
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ a: owner.models.A }) },
			() => ''
		)

		expect((app.routes[0] as any).hooks.body.properties.a.$id).toBe('Own')
	})

	it('keeps a user $id under every name', () => {
		const source = t.Object({ v: t.String() }, { $id: 'Own' })
		const app = new Elysia().model({ a: source, b: source })

		expect((app.models as any).a.$id).toBe('Own')
		expect((app.models as any).b.$id).toBe('Own')
	})

	// `.model()` registers the schema as it is at that call: an edit to the
	// source afterwards must not move validation for any use of the model
	it('validates every use of a model against the source as registered', async () => {
		const source: any = t.Object({ n: t.Number() })
		const app = new Elysia().model({ s: source })
		const model = (app.models as any).s

		source.properties.n = t.String()

		app.post('/name', { body: 's' }, ({ body }) => body).post(
			'/nested',
			{ body: t.Object({ x: model }) },
			({ body }) => body
		)
		const other = new Elysia().post(
			'/other',
			{ body: model },
			({ body }) => body
		)
		const again = new Elysia()
			.model({ again: model })
			.post('/again', { body: 'again' }, ({ body }) => body)

		const send = (
			target: { handle(request: Request): Promise<Response> },
			path: string,
			body: unknown
		) =>
			target
				.handle(
					new Request('http://localhost' + path, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body)
					})
				)
				.then((response) => response.status)

		for (const [target, path, wrap] of [
			[app, '/name', (v: unknown) => v],
			[app, '/nested', (v: unknown) => ({ x: v })],
			[other, '/other', (v: unknown) => v],
			[again, '/again', (v: unknown) => v]
		] as const) {
			expect([path, await send(target, path, wrap({ n: 1 }))]).toEqual([
				path,
				200
			])
			expect([path, await send(target, path, wrap({ n: 'a' }))]).toEqual([
				path,
				422
			])
		}
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

	it('keeps an outer hook deeply frozen when a getter snapshots another hook', () => {
		let reads = 0
		const schema = {
			get reenter() {
				reads++
				snapshotHookSchemas({ body: { unique: () => {} } })

				return true
			},
			child: { value: true },
			unique: () => {}
		}

		const snap = snapshotHookSchemas({ body: schema })!.body

		expect({
			reads,
			rootFrozen: Object.isFrozen(snap),
			childFrozen: Object.isFrozen(snap.child)
		}).toEqual({ reads: 2, rootFrozen: true, childFrozen: true })
	})

	it('keeps a model mutable when snapshotted from a hook getter', () => {
		let reads = 0
		const models: { child: { value: number } }[] = []
		const schema = {
			get reenter() {
				reads++
				models.push(snapshotSchema({ child: { value: reads } }))

				return true
			},
			unique: () => {}
		}

		snapshotHookSchemas({ body: schema })

		expect({
			reads,
			rootFrozen: Object.isFrozen(models[1]!),
			childFrozen: Object.isFrozen(models[1]!.child)
		}).toEqual({ reads: 2, rootFrozen: false, childFrozen: false })
	})

	it('keeps symbol metadata out of interning when a later getter reenters', () => {
		const metadata = Symbol('metadata')
		const identity = () => {}
		let reads = 0
		const make = (value: string) => ({
			tagged: { [metadata]: value },
			get reenter() {
				reads++
				snapshotHookSchemas({ body: { unique: () => {} } })

				return true
			},
			identity
		})

		const a = snapshotHookSchemas({ body: make('a') })!.body
		const b = snapshotHookSchemas({ body: make('b') })!.body

		expect({
			reads,
			sameSnapshot: a === b,
			firstMetadata: a.tagged[metadata],
			secondMetadata: b.tagged[metadata]
		}).toEqual({
			reads: 4,
			sameSnapshot: false,
			firstMetadata: 'a',
			secondMetadata: 'b'
		})
	})
})

describe('a response status map shared between routes', () => {
	it('validates each route against its own map', async () => {
		const app = new Elysia()
			.get(
				'/a',
				{ response: { 200: t.String(), 404: t.String() } },
				() => 'a'
			)
			.get(
				'/b',
				{ response: { 200: t.String(), 404: t.String() } },
				() => 'b'
			)
			// equal to `/a` but for the 200 schema, or one status
			.get(
				'/number',
				{ response: { 200: t.Number(), 404: t.String() } },
				() => 'c' as any
			)
			.get(
				'/teapot',
				{ response: { 200: t.String(), 418: t.String() } },
				() => status(418, 1 as any)
			)

		expect((await app.handle('/a')).status).toBe(200)
		expect((await app.handle('/b')).status).toBe(200)
		expect((await app.handle('/number')).status).toBe(500)
		expect((await app.handle('/teapot')).status).toBe(500)
	})

	it("resolves a model name against each app's own models", async () => {
		const name = new Elysia()
			.model({ User: t.Object({ name: t.String() }) })
			.get('/', { response: { 200: 'User' } }, () => ({ name: 'a' }))
		const id = new Elysia()
			.model({ User: t.Object({ id: t.Number() }) })
			.get(
				'/',
				{ response: { 200: 'User' } },
				() => ({ name: 'a' }) as any
			)

		expect((await name.handle('/')).status).toBe(200)
		expect((await id.handle('/')).status).toBe(500)
	})

	it('keeps a write through app.routes out of every route', async () => {
		const app = new Elysia()
			.get(
				'/a',
				{ response: { 200: t.String() } },
				() => status(404, 'a') as any
			)
			.get(
				'/b',
				{ response: { 200: t.String() } },
				() => status(404, 'b') as any
			)

		// how @elysiajs/openapi adds a status it read from `fromTypes`
		;(app.routes[0]!.hooks.response as any)[404] = t.Number()

		expect((await app.handle('/a')).status).toBe(404)
		expect((await app.handle('/b')).status).toBe(404)
	})
})
