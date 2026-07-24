import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { describe, expect, it } from 'bun:test'
import { req, post } from '../utils'

describe('guard registration', () => {
	it('keeps query validation on a guard that also declares derive', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ x: t.String() }),
				derive: () => ({ k: 42 })
			})
			.get('/', ({ query, k }: any) => ({ query, k }))

		expect((await app.handle(req('/'))).status).toBe(422)

		const ok = await app.handle(req('/?x=hello'))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ query: { x: 'hello' }, k: 42 })
	})

	it('keeps body validation on a guard that also declares derive', async () => {
		const app = new Elysia()
			.guard({
				body: t.Object({ name: t.String() }),
				derive: () => ({ k: 1 })
			})
			.post('/', ({ body }: any) => body)

		expect((await app.handle(post('/', {}))).status).toBe(422)
		expect((await app.handle(post('/', { name: 'a' }))).status).toBe(200)
	})

	it('keeps query validation on group(prefix, { query, derive }, run)', async () => {
		const app = new Elysia().group(
			'/api',
			{ query: t.Object({ x: t.String() }), derive: () => ({ k: 1 }) },
			(g) => g.get('/x', ({ query }: any) => query)
		)

		expect((await app.handle(req('/api/x'))).status).toBe(422)
		expect((await app.handle(req('/api/x?x=ok'))).status).toBe(200)
	})

	it('merges every array-valued derive into context instead of returning it', async () => {
		const app = new Elysia()
			.guard({
				derive: [() => ({ user: 'bob' }), () => ({ role: 'admin' })]
			})
			.get('/', ({ user, role }: any) => ({
				user,
				role,
				handlerRan: true
			}))

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			user: 'bob',
			role: 'admin',
			handlerRan: true
		})
	})
})

describe('loose path registration', () => {
	it('keeps explicit routes with and without a trailing slash distinct', async () => {
		const app = new Elysia()
			.get('/foo', () => 'real-foo')
			.get('/foo/', () => 'foo-slash')

		expect(await (await app.handle(req('/foo'))).text()).toBe('real-foo')
		expect(await (await app.handle(req('/foo/'))).text()).toBe('foo-slash')
	})

	it('keeps trailing-slash routes distinct in reverse registration order', async () => {
		const app = new Elysia()
			.get('/foo/', () => 'foo-slash')
			.get('/foo', () => 'real-foo')

		expect(await (await app.handle(req('/foo'))).text()).toBe('real-foo')
		expect(await (await app.handle(req('/foo/'))).text()).toBe('foo-slash')
	})

	it('still serves the loose twin when only one variant is declared', async () => {
		const app = new Elysia().get('/bar', () => 'bar')

		expect(await (await app.handle(req('/bar/'))).text()).toBe('bar')
	})
})

// Ported from sennen (commit 7e70df83) per
// design/sennen-salvage/002-salvage-rejected-sennen.md Step 2a. Only the
// public-contract cases are ported: embedded parameters, prefix wildcards,
// empty parameters, encoded aliases, and last-route-wins. The rest of that
// file's describe blocks are already present above (pre-existing on stable)
// or out of scope for this slice.
describe('routing edge contracts', () => {
	it('preserves embedded params, prefix wildcards, and empty-param rejection', async () => {
		const app = new Elysia()
			.get('/time:zone', ({ params }: any) => `zone:${params.zone}`)
			.get('/asset*', ({ params }: any) => `asset:${params['*']}`)
			.get('/empty/:id/tail', ({ params }: any) => params.id)

		await expect(
			app.handle(req('/timeUTC')).then((r) => r.text())
		).resolves.toBe('zone:UTC')
		await expect(
			app.handle(req('/assetfoo/bar')).then((r) => r.text())
		).resolves.toBe('asset:foo/bar')
		await expect(
			app.handle(req('/asset')).then((r) => r.text())
		).resolves.toBe('asset:')
		expect((await app.handle(req('/empty//tail'))).status).toBe(404)
	})

	it('keeps the last raw or encoded alias for both request spellings', async () => {
		const app = new Elysia()
			.get('/alias-a/café', () => 'raw-first')
			.get('/alias-a/caf%C3%A9', () => 'encoded-last')
			.get('/alias-b/caf%C3%A9', () => 'encoded-first')
			.get('/alias-b/café', () => 'raw-last')

		for (const path of ['/alias-a/café', '/alias-a/caf%C3%A9'])
			await expect(
				app.handle(req(path)).then((r) => r.text())
			).resolves.toBe('encoded-last')

		for (const path of ['/alias-b/café', '/alias-b/caf%C3%A9'])
			await expect(
				app.handle(req(path)).then((r) => r.text())
			).resolves.toBe('raw-last')
	})
})

describe('route introspection', () => {
	it('exposes inherited guard schemas through .routes and runtime validation', async () => {
		const inner = new Elysia().get('/x', () => 'ok')
		const app = new Elysia()
			.guard({ query: t.Object({ q: t.String() }) })
			.use(inner)

		expect((await app.handle(req('/x'))).status).toBe(422)
		expect((await app.handle(req('/x?q=hi'))).status).toBe(200)

		const route = app.routes.find((r) => r.path === '/x')
		expect(route).toBeDefined()
		expect((route!.hooks as any)?.query).toBeDefined()
	})
})

describe('registration input ownership', () => {
	it('does not mutate the caller object passed to headers', () => {
		const shared = { 'x-a': '1' }
		const app = new Elysia().headers(shared)

		app.headers({ 'x-b': '2' })

		expect(shared).toEqual({ 'x-a': '1' })
		expect((app['~ext'] as any)?.headers).toEqual({
			'x-a': '1',
			'x-b': '2'
		})
	})

	it('does not mutate the caller options across multiple ws calls', () => {
		const opts = { idleTimeout: 5 } as any
		const hA = () => {}
		const hB = () => {}

		expect(() => {
			new Elysia().use(websocket()).ws('/a', opts, hA)
			new Elysia().use(websocket()).ws('/b', opts, hB)
		}).not.toThrow()

		expect(opts.message).toBeUndefined()
		expect(opts).toEqual({ idleTimeout: 5 })
	})

	it('copies a plugin nested plain-object decorator into the parent', () => {
		const plugin = new Elysia({ name: 'p' }).decorate('ctx', {
			db: 'plugin-db'
		})
		const parent = new Elysia().use(plugin)

		const parentCtx = (parent['~ext'] as any)?.decorator?.ctx
		const pluginCtx = (plugin['~ext'] as any)?.decorator?.ctx

		expect(parentCtx).toBeDefined()
		expect(parentCtx).toEqual({ db: 'plugin-db' })
		expect(parentCtx).not.toBe(pluginCtx)

		parentCtx.db = 'mutated'
		expect(pluginCtx.db).toBe('plugin-db')
	})

	it('still shares class-instance decorators by reference (singleton)', () => {
		class Db {
			value = 'shared'
		}
		const instance = new Db()
		const plugin = new Elysia({ name: 'p2' }).decorate('db', instance)
		const parent = new Elysia().use(plugin)

		expect((parent['~ext'] as any)?.decorator?.db).toBe(instance)
	})
})
