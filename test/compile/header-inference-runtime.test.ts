import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const request = (path: string, headers?: HeadersInit) =>
	new Request(`http://localhost${path}`, { headers })

const headerKeys = (app: Elysia<any, any>, path: string) => {
	app.compile()
	const route = app['~generation']!.plan.httpRoutes.find(
		(candidate) => candidate.method === 'GET' && candidate.path === path
	)
	if (!route) throw new Error(`missing AppPlan route GET ${path}`)
	return (route.program.content as any).headerKeys as string[] | null
}

describe('header inference runtime', () => {
	it('preserves cookies with partial headers', async () => {
		const app = new Elysia().get(
			'/cookie',
			({ headers: { authorization }, cookie }) =>
				`${authorization}:${cookie.token.value}`
		)

		const response = await app.handle(
			request('/cookie', {
				authorization: 'bearer',
				cookie: 'token=secret'
			})
		)

		expect(await response.text()).toBe('bearer:secret')
	})

	it('preserves repeated nested header destructuring', async () => {
		const app = new Elysia().get(
			'/headers',
			({ headers: { authorization }, headers: { origin } }) =>
				`${authorization}:${origin}`
		)

		const response = await app.handle(
			request('/headers', {
				authorization: 'bearer',
				origin: 'elysia'
			})
		)

		expect(await response.text()).toBe('bearer:elysia')
	})

	it('selects a literal bracket header key', async () => {
		const app = new Elysia().get(
			'/bracket',
			({ headers }) => headers['x-extra']
		)

		const response = await app.handle(
			request('/bracket', { 'x-extra': 'extra' })
		)

		expect(await response.text()).toBe('extra')
		expect(headerKeys(app, '/bracket')).toEqual(['x-extra'])
	})

	it('materializes full headers for ASCII and Unicode object aliases', async () => {
		const app = new Elysia()
			.get(
				'/alias',
				({ headers: all, headers: { authorization } }) =>
					`${authorization}:${all.origin}`
			)
			.get(
				'/unicode',
				({ headers: 全部, headers: { authorization } }) =>
					`${authorization}:${全部.origin}`
			)

		for (const path of ['/alias', '/unicode']) {
			const response = await app.handle(
				request(path, {
					authorization: 'bearer',
					origin: 'elysia'
				})
			)

			expect(await response.text()).toBe('bearer:elysia')
			expect(headerKeys(app, path)).toBeNull()
		}
	})

	it('fails open when selective headers cannot preserve semantics', async () => {
		const readOrigin = (headers: Record<string, string | undefined>) =>
			headers.origin
		const app = new Elysia()
			.get('/rest', ({ headers: { authorization, ...headers } }) =>
				`${authorization}:${headers.origin}`
			)
			.get('/escape', ({ headers }) => readOrigin(headers))
			.get('/uppercase', ({ headers }) => String(headers.Authorization))
			.get('/context-rest', ({ ...rest }) =>
				Object(rest).headers.authorization
			)
			.get('/invalid-name', ({ headers }) => String(headers['not valid']))
			.get('/set-cookie', ({ headers }) => headers['set-cookie'])
			.get('/computed-global', ({ headers }) => headers[globalThis.name])
			.get('/opaque', (context) =>
				Object(context).headers.authorization
			)
			.get('/redestructured-context', (context) => {
				const { headers } = context
				return context.headers.authorization ?? Object.keys(headers).length
			})

		for (const [path, expected] of [
			['/rest', 'bearer:elysia'],
			['/escape', 'elysia'],
			['/uppercase', 'undefined'],
			['/context-rest', 'bearer'],
			['/invalid-name', 'undefined'],
			['/set-cookie', '["session=one"]'],
			['/computed-global', 'computed'],
			['/opaque', 'bearer'],
			['/redestructured-context', 'bearer']
		] as const) {
			const response = await app.handle(
				request(path, {
					authorization: 'bearer',
					origin: 'elysia',
					'set-cookie': 'session=one',
					[String(globalThis.name)]: 'computed'
				})
			)

			expect(await response.text()).toBe(expected)
			expect(headerKeys(app, path)).toBeNull()
		}
	})
})
