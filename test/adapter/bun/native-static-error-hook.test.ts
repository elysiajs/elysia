// Error hooks cannot observe promoted static GETs, so they must not block promotion.
// HEAD remains an accepted difference between Bun's native and JS lanes.

import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'
import { collectStaticRoutes } from '../../../src/adapter/bun'

const snapshot = async (response: Response) => ({
	status: response.status,
	// Ignore Bun's native-only ETag when comparing lanes.
	headers: [...response.headers.entries()].filter(([k]) => k !== 'etag'),
	body: await response.text()
})

const withApps = async (
	make: (
		app: Elysia<any, any, any, any, any, any, any>
	) => Elysia<any, any, any, any, any, any, any>,
	run: (promoted: string, js: string) => Promise<void>
) => {
	const promoted = make(new Elysia({ nativeStaticResponse: true } as any))
	const js = make(new Elysia({ nativeStaticResponse: false } as any))

	promoted.listen(0)
	js.listen(0)

	try {
		await run(
			`http://localhost:${promoted.server!.port}`,
			`http://localhost:${js.server!.port}`
		)
	} finally {
		await Promise.all([promoted.stop(true), js.stop(true)])
	}
}

describe('native static promotion with an error hook', () => {
	it('promotes a static literal behind a global error hook', () => {
		const app = new Elysia().error(() => {}).get('/', 'ok')

		expect(collectStaticRoutes(app as any)?.['/']?.GET).toBeInstanceOf(
			Response
		)
	})

	it('promotes a static literal behind a route-local error hook', () => {
		const app = new Elysia().get('/', { error: () => {} }, 'ok')

		expect(collectStaticRoutes(app as any)?.['/']?.GET).toBeInstanceOf(
			Response
		)
	})

	it('keeps every other hook disqualifying next to an error hook', () => {
		// Only `error` is known to be unobservable.
		const local = (hook: Record<string, unknown>) =>
			collectStaticRoutes(
				new Elysia().error(() => {}).get('/', hook as any, 'ok') as any
			)?.['/']?.GET

		expect(local({ afterResponse: () => {} })).toBeUndefined()
		expect(local({ mapResponse: () => {} })).toBeUndefined()
		expect(local({ beforeHandle: () => {} })).toBeUndefined()
		expect(local({ afterHandle: () => {} })).toBeUndefined()
		expect(local({ transform: () => {} })).toBeUndefined()
		expect(local({ parse: () => {} })).toBeUndefined()

		expect(
			collectStaticRoutes(
				new Elysia()
					.error(() => {})
					.request(() => {})
					.get('/', 'ok') as any
			)
		).toBeUndefined()
	})

	it('serves GET byte-identically on both lanes and never runs the hook', async () => {
		const seen: string[] = []

		await withApps(
			(app) =>
				app
					.headers({ 'x-app': 'elysia' })
					.error(({ request }) => {
						seen.push(
							request.method + ' ' + new URL(request.url).pathname
						)
					})
					.get('/', 'ok'),
			async (promoted, js) => {
				const [a, b] = await Promise.all([
					fetch(promoted + '/').then(snapshot),
					fetch(js + '/').then(snapshot)
				])

				expect(a).toEqual(b)
				expect(a.status).toBe(200)
				expect(a.body).toBe('ok')
				expect(a.headers).toContainEqual(['x-app', 'elysia'])
				expect(seen).toEqual([])

				// Misses still run the hook on both lanes.
				const [c, d] = await Promise.all([
					fetch(promoted + '/missing').then(snapshot),
					fetch(js + '/missing').then(snapshot)
				])
				expect(c).toEqual(d)
				expect(c.status).toBe(404)
				expect(seen).toEqual(['GET /missing', 'GET /missing'])
			}
		)
	})

	it('answers HEAD per the accepted native policy (X1): 200 promoted, 404 + error hook on the JS lane', async () => {
		const seen: string[] = []

		await withApps(
			(app) =>
				app
					.error(({ request }) => {
						seen.push(request.method)
					})
					.get('/', 'ok'),
			async (promoted, js) => {
				const a = await fetch(promoted + '/', { method: 'HEAD' })
				expect(a.status).toBe(200)
				await expect(a.text()).resolves.toBe('')
				expect(seen).toEqual([])

				const b = await fetch(js + '/', { method: 'HEAD' })
				expect(b.status).toBe(404)
				expect(seen).toEqual(['HEAD'])

				// Other methods still miss and run the hook on both lanes.
				seen.length = 0
				const [c, d] = await Promise.all([
					fetch(promoted + '/', { method: 'POST' }).then(snapshot),
					fetch(js + '/', { method: 'POST' }).then(snapshot)
				])
				expect(c).toEqual(d)
				expect(c.status).toBe(404)
				expect(seen).toEqual(['POST', 'POST'])
			}
		)
	})
})
