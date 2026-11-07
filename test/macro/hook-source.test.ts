import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import {
	buildNativeStaticResponse,
	composeRouteHook
} from '../../src/compile/handler'

// A plugin reads `~source` to tell a hook the route or a `.guard()` asked
// for from one a plain `.derive()` or `.on*()` call installed
const hooksOf = (
	app: Elysia<any, any, any, any, any, any, any, any>,
	path: string
) => (app.routes as any[]).find((route) => route.path === path)!.hooks

const sourceOf = (hooks: any, fn: unknown) => hooks['~source']?.get(fn)

const route = (role: string, ...path: string[]) => ({
	from: 'route',
	role,
	path
})
const guard = (role: string, ...path: string[]) => ({
	from: 'guard',
	role,
	path
})
const call = (role: string) => ({ from: 'call', role, path: [] })

describe('Hook source', () => {
	const user = () => ({ user: 'u' })
	const gate = () => {}
	const auth = new Elysia({ name: 'auth' }).macro({
		auth: { derive: user },
		gate: { beforeHandle: gate },
		session: { auth: true }
	})

	it('names the route option key a macro hook came from', () => {
		const app = new Elysia().use(auth).get('/', { auth: true }, () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), user)).toEqual([
			route('derive', 'auth')
		])
	})

	it('names the route a nested macro hook came from, outermost first', () => {
		const app = new Elysia()
			.use(auth)
			.get('/', { session: true }, () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), user)).toEqual([
			route('derive', 'session', 'auth')
		])
	})

	it('names an inline derive the route wrote', () => {
		const own = () => ({ own: 1 })
		const app = new Elysia()
			.use(auth)
			.get('/', { derive: own, gate: true }, () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), own)).toEqual([
			route('derive', 'derive')
		])
		expect(sourceOf(hooksOf(app, '/'), gate)).toEqual([
			route('beforeHandle', 'gate')
		])
	})

	// Elysia expands a seed once per route; the key that repeated it still
	// asked for what it installed, below it as much as at it
	it('gives a key skipped as a repeated seed what that seed installed', () => {
		const app = new Elysia()
			.use(auth)
			.macro({ wrap: { session: true } })
			.get('/first', { session: true, auth: true }, () => 'ok')
			.get('/nested', { auth: true, wrap: true }, () => 'ok')
			.get('/below', { session: true, wrap: true }, () => 'ok')

		expect(sourceOf(hooksOf(app, '/first'), user)).toEqual([
			route('derive', 'session', 'auth'),
			route('derive', 'auth')
		])
		expect(sourceOf(hooksOf(app, '/nested'), user)).toEqual([
			route('derive', 'auth'),
			route('derive', 'wrap', 'session', 'auth')
		])
		expect(sourceOf(hooksOf(app, '/below'), user)).toEqual([
			route('derive', 'session', 'auth'),
			route('derive', 'wrap', 'session', 'auth')
		])
	})

	it('keeps a .guard() macro apart from the route, flat and scoped', () => {
		const app = new Elysia()
			.use(auth)
			.guard({ auth: true }, (scoped) =>
				scoped.get('/scoped', () => 'ok')
			)
			.guard({ gate: true })
			.get('/flat', { auth: true }, () => 'ok')

		expect(sourceOf(hooksOf(app, '/scoped'), user)).toEqual([
			guard('derive', 'auth')
		])

		const flat = hooksOf(app, '/flat')
		expect(sourceOf(flat, gate)).toEqual([guard('beforeHandle', 'gate')])
		expect(sourceOf(flat, user)).toEqual([route('derive', 'auth')])
	})

	it('names a derive written in a .guard() and a plain .derive() as a call', () => {
		const written = () => ({ written: 1 })
		const plain = () => ({ plain: 1 })
		const before = () => {}
		const app = new Elysia()
			.derive(plain)
			.onBeforeHandle(before)
			.guard({ derive: written })
			.get('/', () => 'ok')

		const hooks = hooksOf(app, '/')
		expect(sourceOf(hooks, written)).toEqual([guard('derive', 'derive')])
		expect(sourceOf(hooks, plain)).toEqual([call('derive')])
		expect(sourceOf(hooks, before)).toEqual([call('beforeHandle')])
	})

	it('names a .mapDerive() call by its function', () => {
		const mapped = () => ({ mapped: 1 })
		const app = new Elysia().mapDerive(mapped).get('/', () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), mapped)).toEqual([call('derive')])
	})

	// one function, two occurrences: judged by the event each was installed as
	it('records the event of each occurrence of a function', () => {
		const app = new Elysia()
			.derive(user)
			.get('/', { afterHandle: user } as any, () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), user)).toEqual([
			route('afterHandle', 'afterHandle'),
			call('derive')
		])
	})

	it("names a plugin-scoped .guard() on the parent's routes", () => {
		const plugin = new Elysia({ name: 'session' })
			.use(auth)
			.guard('plugin', { auth: true })
		const app = new Elysia().use(plugin).get('/', () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), user)).toEqual([
			guard('derive', 'auth')
		])
	})

	// the parent installs a copy without `schema`
	it('names a propagated .guard() copy', () => {
		const written = () => ({ written: 1 })
		const plugin = new Elysia({ name: 'merge' }).guard('plugin', {
			schema: 'merge',
			derive: written
		})
		const app = new Elysia().use(plugin).get('/', () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), written)).toEqual([
			guard('derive', 'derive')
		])
	})

	it("names a parent's .guard() on the routes of a plugin it uses", () => {
		const app = new Elysia()
			.use(auth)
			.guard({ auth: true })
			.use(new Elysia().get('/', () => 'ok'))

		expect(sourceOf(hooksOf(app, '/'), user)).toEqual([
			guard('derive', 'auth')
		])
	})

	it('names an inline derive on a route that selects no macro', () => {
		const own = () => ({ own: 1 })
		const app = new Elysia()
			.use(auth)
			.guard({ gate: true }, (scoped) =>
				scoped.get('/', { derive: own }, () => 'ok')
			)

		expect(sourceOf(hooksOf(app, '/'), own)).toEqual([
			route('derive', 'derive')
		])
	})

	it("leaves a macro's argument out unless the macro installs it", () => {
		const check = () => true
		const app = new Elysia()
			.macro({
				permission: (_: () => boolean) => ({ beforeHandle: gate })
			})
			.get('/', { permission: check }, () => 'ok')

		const hooks = hooksOf(app, '/')
		expect(sourceOf(hooks, check)).toBeUndefined()
		expect(sourceOf(hooks, gate)).toEqual([
			route('beforeHandle', 'permission')
		])
	})

	it('shares one frozen array per option key path', () => {
		const app = new Elysia()
			.use(auth)
			.get('/a', { auth: true }, () => 'ok')
			.get('/b', { auth: true }, () => 'ok')

		const [a] = sourceOf(hooksOf(app, '/a'), user)
		const [b] = sourceOf(hooksOf(app, '/b'), user)
		expect(a.path).toBe(b.path)
		expect(Object.isFrozen(a.path)).toBe(true)
	})

	// kept off the hooks a route compiles from, so no lane or fast path sees it
	it("keeps a plugin's .guard({ beforeHandle }) in the compact lane", () => {
		const app = new Elysia()
			.onBeforeHandle(() => {})
			.use(
				new Elysia().guard({ beforeHandle: gate }).get('/', () => 'ok')
			)
		const [, , , instance, hook, appHook, inherited, scope] = (app as any)[
			'~routes'
		][0]

		const compiled: any = composeRouteHook(
			instance,
			hook,
			appHook,
			inherited,
			app as any,
			scope,
			true
		)
		expect(compiled['~beforeHandlePrefix']).toBeDefined()
		expect(sourceOf(hooksOf(app, '/'), gate)).toEqual([
			guard('beforeHandle', 'beforeHandle')
		])
	})

	it('keeps a static route under a .guard({ error }) native', () => {
		const error = () => {}
		for (const app of [
			new Elysia().guard({ error }).get('/', 'hi'),
			new Elysia().group('/g', { error }, (group) => group.get('/', 'hi'))
		])
			expect(
				buildNativeStaticResponse(
					(app as any)['~routes'][0],
					app as any
				)
			).toBeInstanceOf(Response)
	})

	// Elysia installs a `.guard()`'s `derive` before any macro of that name
	it('names a .guard() derive even with a macro named derive', () => {
		const written = () => ({ written: 1 })
		const app = new Elysia()
			.macro({ derive: () => ({}) } as {})
			.guard({ derive: written })
			.get('/', () => 'ok')

		expect(sourceOf(hooksOf(app, '/'), written)).toEqual([
			guard('derive', 'derive')
		])
	})

	// a key that expanded to nothing stays on the hook and is expanded again
	// when the route compiles: what that pass installs is the route's too
	it('names what a second expansion of a route installs', () => {
		let calls = 0
		const late = () => ({ late: 1 })
		const app = new Elysia()
			.macro({ late: () => (++calls === 1 ? {} : { derive: late }) })
			.get('/', { late: true }, () => 'ok')

		const hooks = hooksOf(app, '/')
		expect(hooks['~deriveEntries']).toEqual([late])
		expect(sourceOf(hooks, late)).toEqual([route('derive', 'late')])
	})

	it('names what a route wrote after an app without macros seals', async () => {
		const own = () => ({ own: 1 })
		const app = new Elysia().get('/', { derive: own }, () => 'ok')
		await app.handle(new Request('http://localhost/'))

		expect(sourceOf(hooksOf(app, '/'), own)).toEqual([
			route('derive', 'derive')
		])
	})

	// production releases build caches; a guard macro expanded again would
	// hand later readers another hook than the compiled one
	it('runs no .guard() macro factory again for .routes in production', async () => {
		const previous = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'
		try {
			let generation = 0
			const app = new Elysia({ precompile: true })
				.macro({
					fresh: () => {
						const mine = ++generation

						return {
							beforeHandle: () => {
								if (mine !== generation) return 'stale'
							}
						}
					}
				})
				.guard({ fresh: true })
				.get('/', () => 'ok')
			await app.handle(new Request('http://localhost/'))
			const calls = generation

			hooksOf(app, '/')

			expect(generation).toBe(calls)
			expect(
				await (
					await app.handle(new Request('http://localhost/'))
				).text()
			).toBe('ok')
		} finally {
			process.env.NODE_ENV = previous
		}
	})

	for (const mode of ['development', 'production'])
		// production drops the build caches; `.routes` reads the built hooks
		it(`reads the hooks a route was built from, in ${mode}`, async () => {
			const previous = process.env.NODE_ENV
			process.env.NODE_ENV = mode
			try {
				let calls = 0
				const app = new Elysia()
					.macro({
						counted: () =>
							++calls === 1 ? { derive: user } : { derive: gate }
					})
					.get('/', { counted: true }, () => 'ok')
				await app.handle(new Request('http://localhost/'))

				const hooks = hooksOf(app, '/')
				hooksOf(app, '/')

				expect(calls).toBe(1)
				expect(hooks['~deriveEntries']).toEqual([user])
				expect(sourceOf(hooks, user)).toEqual([
					route('derive', 'counted')
				])
			} finally {
				process.env.NODE_ENV = previous
			}
		})
})
