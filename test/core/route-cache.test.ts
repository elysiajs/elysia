import { describe, it, expect } from 'bun:test'

import { Elysia, t } from '../../src'

const build = () => {
	const plugin = new Elysia({ name: 'cache-plugin' }).derive(() => ({ a: 1 }))

	return new Elysia()
		.use(plugin)
		.beforeHandle(() => {})
		.get('/a', () => 'a')
		.get('/b', { body: t.Object({ x: t.String() }) }, () => 'b')
}

const seal = (app: Elysia<any, any, any, any, any, any, any, any>) => {
	void app.fetch
	expect(app['~generation']).toBeDefined()

	return app
}

const shape = (app: any) =>
	app.routes.map((route: any) => ({
		method: route.method,
		path: route.path,
		hooks: Object.keys(route.hooks ?? {}).sort()
	}))

describe('route introspection cache', () => {
	it('sealing does not change composed content', () => {
		const before = shape(build())
		const after = shape(seal(build()))

		expect(after).toEqual(before)
		expect(after.length).toBe(2)
		// a plugin `derive` + root `beforeHandle` must survive the memo
		expect(after[1].hooks).toContain('beforeHandle')
	})

	it('recomposes per access while unsealed, memoizes once sealed', () => {
		const open = build()

		// teeth: without the memo every access rebuilds the array AND the
		// composed hook object. If this ever becomes `toBe`, the assertions
		// below stop proving anything.
		expect(open.routes).not.toBe(open.routes)
		expect(open.routes[0].hooks).not.toBe(open.routes[0].hooks)

		const sealed = seal(build())

		expect(sealed.routes).toBe(sealed.routes)
		expect(sealed.routes[0].hooks).toBe(sealed.routes[0].hooks)
		expect(sealed.history).toBe(sealed.history)
	})

	it('a route added across a re-seal is observed', () => {
		const app = seal(build())

		expect(app.routes.length).toBe(2)
		expect(app.history.length).toBe(2)

		const generation = app['~generation']

		// the only legal post-seal mutation path (see test/core/generation.test.ts)
		;(app as any)['~generation'] = undefined
		app.get('/late', () => 'late')
		app['~newGeneration']()

		expect(app['~generation']).not.toBe(generation)
		expect(app.routes.length).toBe(3)
		expect(app.routes.map((route) => route.path)).toContain('/late')
		expect(app.history.length).toBe(3)
		expect(app.history.at(-1)!.path).toBe('/late')
	})

	it('a plugin merged across a re-seal is observed', () => {
		const app = seal(build())

		expect(app.routes.length).toBe(2)

		;(app as any)['~generation'] = undefined
		app.use(new Elysia({ name: 'late-plugin' }).get('/plugged', () => 'p'))
		app['~newGeneration']()

		expect(app.routes.map((route) => route.path)).toContain('/plugged')
		expect(app.history.map((entry) => entry.path)).toContain('/plugged')
	})

	it('re-seal invalidates the sibling artifact, whichever is read first', () => {
		const app = seal(build())

		expect(app.routes.length).toBe(2)
		expect(app.history.length).toBe(2)

		;(app as any)['~generation'] = undefined
		app.get('/late', () => 'late')
		app['~newGeneration']()

		expect(app.history.length).toBe(3)
		expect(app.routes.length).toBe(3)
	})

	it('observes a merged plugin mutated after the parent sealed', async () => {
		const ran: string[] = []
		const plugin = new Elysia({ name: 'late-error' }).get('/p', () => {
			throw new Error('boom')
		})
		const app = seal(new Elysia().use(plugin))

		const errorHooks = () =>
			(app.routes[0].hooks as any)?.error?.length ?? 0

		expect(errorHooks()).toBe(0)

		plugin.error(() => {
			ran.push('late')
			return new Response('handled', { status: 500 })
		})

		await (await app.handle(new Request('http://e.ly/p'))).text()

		expect(ran).toContain('late')
		expect(errorHooks()).toBe(1)
	})

	it('caches per instance, not across apps', () => {
		const one = seal(new Elysia().get('/one', () => 'one'))
		const two = seal(new Elysia().get('/two', () => 'two'))

		expect(one.routes[0].path).toBe('/one')
		expect(two.routes[0].path).toBe('/two')
		expect(one.routes).not.toBe(two.routes)
	})

	it('memoizes macro apps, whose routes take the resolve path', () => {
		const app = seal(
			new Elysia()
				.macro({
					auth: () => ({ beforeHandle() {} })
				})
				.get('/m', { auth: true } as any, () => 'm')
		)

		expect(app.routes).toBe(app.routes)
		expect(app.routes[0].hooks.beforeHandle).toBeDefined()
	})
})
