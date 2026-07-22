import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { createAdapter } from '../../src/adapter'
import { contextDefaults } from '../../src/adapter/default-headers'
import { WebStandardAdapter } from '../../src/adapter/web-standard'
import { compileHandler } from '../../src/compile/handler'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { req, post } from '../utils'
import { materialiseHandlers, registerManifest } from './_manifest'

/** Body parsing materializes all headers only when route code needs them. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia)['~routes']![index]
	const fn = compileHandler(route as any, app)
	return { fn, name: fn.constructor.name, source: fn.toString() }
}

describe('body parsing without full header access', () => {
	it('reads content-type once and uses compact response mapping', () => {
		const app = new Elysia().post('/echo', ({ body }) => body)

		const { source } = compileRoute(app)

		expect(source).toContain("c.request.headers.get('content-type')")
		expect(
			source.match(/c\.request\.headers\.get\('content-type'\)/g)
		).toHaveLength(1)
		expect(source).toContain('let ce=nc(ct)')
		expect(source).toContain(
			"let cj=(ce.charCodeAt(12)===106&&ce==='application/json')||ce.endsWith('+json')"
		)
		expect(source).toContain(
			'c.body=cj?(_bs=true,await pj(c)):(_bs=true,await pd(c,ce,true))'
		)
		expect(source).not.toContain('c.contentType=ct')
		expect(source).not.toContain('c.headers=')
		expect(source).not.toContain('.toJSON()')
		expect(source).toContain('rc(_r,c.request,true)')
		expect(source).not.toContain('rm(')
	})

	it('parses JSON bodies without a schema', async () => {
		const app = new Elysia().post('/echo', ({ body }) => body)
		const res = await app.handle(post('/echo', { name: 'saltyaom' }))
		await expect(res.json()).resolves.toEqual({ name: 'saltyaom' })
	})

	it('POST with body schema reads content-type directly and validates', async () => {
		const app = new Elysia().post(
			'/echo',
			{
				body: t.Object({ name: t.String() })
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain("c.request.headers.get('content-type')")
		expect(
			source.match(/c\.request\.headers\.get\('content-type'\)/g)
		).toHaveLength(1)
		expect(source).toContain('let ce=nc(ct)')
		expect(source).toContain(
			"let cj=(ce.charCodeAt(12)===106&&ce==='application/json')||ce.endsWith('+json')"
		)
		expect(source).toContain(
			'c.body=cj?(_bs=true,await pj(c)):(_bs=true,await pd(c,ce,true))'
		)
		expect(source).not.toContain('c.contentType=ct')
		expect(source).not.toContain('c.headers=')

		const ok = await app.handle(post('/echo', { name: 'x' }))
		await expect(ok.json()).resolves.toEqual({ name: 'x' })

		const bad = await app.handle(post('/echo', { name: 1 }))
		expect(bad.status).toBe(422)
	})

	it('materializes headers when the handler reads them', async () => {
		const app = new Elysia().post(
			'/h',
			({ headers }) => headers['x-foo'] ?? 'none'
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.headers=')
		expect(source).toContain('rc(')
		expect(source).not.toContain('rm(')

		const res = await app.handle(
			req('/h', { method: 'POST', headers: { 'x-foo': 'bar' } })
		)
		await expect(res.text()).resolves.toBe('bar')
	})

	it('materializes headers when a custom parser reads them', () => {
		const app = new Elysia().post(
			'/p',
			{
				parse(c) {
					return (c.headers as any)['x-custom'] ? 'hi' : undefined
				}
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.headers=')
		expect(source).toContain("c.headers['content-type']")
	})

	it('custom parser still receives parser-only contentType context', async () => {
		let seen: string | undefined
		const app = new Elysia().post(
			'/p',
			{
				parse({ contentType, request }) {
					seen = contentType
					if (contentType === 'application/json')
						return request.json()
				}
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.contentType=ct')

		const res = await app.handle(
			req('/p', {
				method: 'POST',
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body: JSON.stringify({ name: 'saltyaom' })
			})
		)

		expect(seen).toBe('application/json')
		await expect(res.json()).resolves.toEqual({ name: 'saltyaom' })
	})

	it('materializes headers for a headers schema', () => {
		const app = new Elysia().post(
			'/hs',
			{
				headers: t.Object({ 'x-foo': t.String() })
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.headers=')
		expect(source).toContain("va.headers.From(c.headers,'headers')")
	})
})

describe('header reads and response set handling', () => {
	it('a GET that only reads headers uses compact response mapping', async () => {
		const app = new Elysia().get(
			'/h',
			({ headers }) => headers['x-foo'] ?? ''
		)

		const { source } = compileRoute(app)
		expect(source).toContain('c.headers=')
		expect(source).toContain('rc(_r,c.request,true)')
		expect(source).not.toContain('c.set')

		const res = await app.handle(req('/h', { headers: { 'x-foo': 'baz' } }))
		await expect(res.text()).resolves.toBe('baz')
	})

	it('a route that writes c.set stays set-aware', async () => {
		const app = new Elysia().get('/s', ({ set }) => {
			set.headers['x-y'] = 'z'
			return 'hi'
		})

		const res = await app.handle(req('/s'))
		expect(res.headers.get('x-y')).toBe('z')
	})

	it('a canonical default-header program shares immutable response state', async () => {
		const seen: unknown[] = []
		const adapter = createAdapter({
			...WebStandardAdapter,
			response: {
				...WebStandardAdapter.response,
				map(value: unknown, set: any, ...params: unknown[]) {
					seen.push(set)
					return (WebStandardAdapter.response.map as any)(
						value,
						set,
						...params
					)
				}
			}
		})
		const build = () =>
			new Elysia({ adapter })
				.headers({ 'x-app': 'default' })
				.get('/d', () => 'hi')

		const artifacts = await captureArtifacts(build())
		expect(artifacts.handlers).toEqual([
			{ method: 'GET', path: '/d', program: [1, 2] }
		])
		registerManifest({ handlers: materialiseHandlers(artifacts.handlers) })

		const app = build()
		const defaults = contextDefaults(app).response!
		expect(Object.isFrozen(defaults)).toBeTrue()
		expect(Object.isFrozen(defaults.headers)).toBeTrue()
		expect(contextDefaults(app).response).toBe(defaults)
		;(app as any).compile()

		for (let i = 0; i < 2; i++) {
			const response = await app.handle(req('/d'))
			expect(response.headers.get('x-app')).toBe('default')
			await expect(response.text()).resolves.toBe('hi')
		}
		expect(seen).toHaveLength(2)
		expect(seen[0]).toBe(defaults)
		expect(seen[1]).toBe(defaults)
		expect(defaults.headers['x-app']).toBe('default')
	})

	it('afterResponse observes status writeback', async () => {
		let observed: unknown
		const app = new Elysia()
			.afterResponse(({ set }) => {
				observed = set.status
			})
			.get('/st', ({ status }) => status(418))

		const res = await app.handle(req('/st'))
		expect(res.status).toBe(418)
		await new Promise((r) => setTimeout(r, 10))
		expect(observed).toBe(418)
	})

	it('set writes stay set-aware while header-only reads stay compact', async () => {
		const writes = new Elysia().get('/w', ({ set }) => {
			set.status = 418
			return 'hi'
		})
		const reads = new Elysia().get(
			'/r',
			({ headers }) => headers['x-foo'] ?? ''
		)

		await expect(
			writes.handle(req('/w')).then((r) => r.status)
		).resolves.toBe(418)
		expect(compileRoute(reads).source).toContain('rc(_r,c.request,true)')
	})
})
