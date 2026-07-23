import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { RouteEffect } from '../../src/compile/handler/descriptor'
import type { BalancedHttpProgram } from '../../src/compile/handler/balanced-program'

const request = (path: string, init?: RequestInit) =>
	new Request(`http://localhost${path}`, init)

const planned = (app: Elysia<any, any>, method: string, path: string) => {
	app.compile()
	const generation = app['~generation']!
	const route = generation.plan.httpRoutes.find(
		(candidate) => candidate.method === method && candidate.path === path
	)
	if (!route) throw new Error(`missing AppPlan route ${method} ${path}`)
	return {
		generation,
		route,
		program: route.program.content as unknown as BalancedHttpProgram
	}
}

describe('Generation AppPlan route introspection', () => {
	it('publishes handler forms without a side descriptor cache', () => {
		const app = new Elysia()
			.get('/function', () => 'function')
			.get('/static', 'static')
			.get('/response', new Response('response'))
			.get('/promise', Promise.resolve('promise') as any)
		app.compile()

		expect(app['~generation']!.introspection).toBeUndefined()
		expect(
			app['~generation']!.plan.httpRoutes.map(({ path, handlerForm }) => [
				path,
				handlerForm
			])
		).toEqual([
			['/function', 'function'],
			['/static', 'response'],
			['/response', 'response'],
			['/promise', 'promise']
		])
	})

	it('exposes canonical channel, body, and validator decisions', () => {
		const app = new Elysia()
			.get(
				'/validated',
				{
					query: t.Object({ q: t.Optional(t.String()) }),
					headers: t.Object({ authorization: t.Optional(t.String()) })
				},
				() => 'ok'
			)
			.post(
				'/body',
				{ body: t.Object({ value: t.String() }) },
				({ body }) => body
			)

		const validated = planned(app, 'GET', '/validated')
		expect(validated.program.effectMask).toBe(
			RouteEffect.Query | RouteEffect.Headers
		)
		expect(validated.program.validators).toEqual(['headers', 'query'])

		const body = planned(app, 'POST', '/body')
		expect(body.program.body).toMatchObject({
			enabled: true,
			mode: 'default',
			fallback: true,
			presence: 'content-type'
		})
		expect(body.program.validators).toContain('body')
	})

	it('exposes lifecycle, cookie, trace, and header inference decisions', () => {
		const app = new Elysia()
			.trace(({ onHandle }) => onHandle(() => {}))
			.get(
				'/route/:id',
				{
					beforeHandle() {},
					cookie: t.Cookie(
						{ sid: t.String() },
						{ secrets: 'secret', sign: ['sid'] }
					)
				},
				({ route, headers: { authorization } }) => `${route}:${authorization}`
			)

		const { program, route } = planned(app, 'GET', '/route/:id')
		expect(program.effectMask).toBe(
			RouteEffect.Headers | RouteEffect.Route | RouteEffect.SetHeaders
		)
		expect(program.headerKeys).toEqual(['authorization', 'cookie'])
		expect(program.hooks.before).toBe(1)
		expect(program.cookie).toMatchObject({ hasSign: true })
		expect(program.trace).toMatchObject({ count: 1 })
		expect(
			route.lifecycle.some(({ phase }) => phase === 'beforeHandle')
		).toBeTrue()
	})

	it('fails open to full headers for computed access', () => {
		const app = new Elysia().get(
			'/headers',
			({ headers }) => headers[Object.keys({ authorization: true })[0]]
		)

		expect(planned(app, 'GET', '/headers').program.headerKeys).toBeNull()
	})

	it('settles a registered structural thenable exactly once', async () => {
		let getter = 0
		let invoked = 0
		const app = new Elysia().get('/thenable', {
			get then() {
				getter++
				return (resolve: (value: string) => void) => {
					invoked++
					resolve('settled')
				}
			}
		} as any)

		for (let i = 0; i < 2; i++)
			await expect(
				(await app.handle(request('/thenable'))).text()
			).resolves.toBe('settled')

		expect({ getter, invoked }).toEqual({ getter: 1, invoked: 1 })
		expect(planned(app, 'GET', '/thenable').route.handlerForm).toBe('promise')
	})

	it('reuses the same immutable program after publication', async () => {
		const app = new Elysia().get('/x', () => 'ok')
		await app.handle(request('/x'))
		const generation = app['~generation']!
		const plan = generation.plan
		const program = plan.httpRoutes[0]!.program

		await app.handle(request('/x'))
		expect(app['~generation']).toBe(generation)
		expect(app['~generation']!.plan).toBe(plan)
		expect(app['~generation']!.plan.httpRoutes[0]!.program).toBe(program)
		expect(Object.isFrozen(program)).toBeTrue()
	})
})
