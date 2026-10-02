import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'
import type { AnyElysia } from '../../../src/base'
import { collectStaticRoutes, isHTMLBundle } from '../../../src/adapter/bun'

import index from './html-bundle.fixture.html'

const serve = async (app: AnyElysia) => {
	app.listen(0)

	try {
		const response = await fetch(`http://localhost:${app.server!.port}/`)

		return { response, body: await response.text() }
	} finally {
		await app.stop(true)
	}
}

describe('Bun HTML import route', () => {
	it('promotes the bundle itself instead of mapping it to JSON', () => {
		expect(isHTMLBundle(index)).toBe(true)

		const promoted = collectStaticRoutes(
			new Elysia().get('/', index) as any
		)

		// mapResponse would turn the opaque bundle into `{}`; only Bun's
		// native router knows how to serve it
		expect(promoted?.['/']?.GET).toBe(index)
	})

	it('serves the bundled page over a real request', async () => {
		const { response, body } = await serve(new Elysia().get('/', index))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('text/html')
		expect(body).toContain('id="fixture"')
		expect(body).not.toBe('{}')
	})

	it("keeps Bun's HMR dev server for bundle routes", async () => {
		// Bun only starts the HTML dev server for bundle routes present when
		// Bun.serve() is created; a bundle first installed through
		// server.reload() is served prebundled without hot reloading
		const { response, body } = await serve(
			new Elysia({ serve: { development: { hmr: true } } }).get(
				'/',
				index
			)
		)

		expect(response.status).toBe(200)
		expect(body).toContain('data-bun-dev-server-script')
	})

	it('still serves the page when a request hook blocks Response promotion', async () => {
		// a fetch-level hook must not push the bundle onto the JS lane,
		// where it cannot be served at all
		const { response, body } = await serve(
			new Elysia().request(() => {}).get('/', index)
		)

		expect(response.status).toBe(200)
		expect(body).toContain('id="fixture"')
	})

	it('leaves plain literals on the JS lane when a request hook is present', () => {
		expect(
			collectStaticRoutes(
				new Elysia().request(() => {}).get('/literal', 'literal') as any
			)
		).toBeUndefined()
	})

	// Bun's router matches before fetch: a native `/*` bundle alone would
	// answer every GET under it, API routes included. Elysia's own routes are
	// registered natively as hand-offs so Bun's specificity picks them
	it('serves a wildcard bundle as SPA fallback without shadowing routes', async () => {
		const app = new Elysia()
			.request(({ set }) => {
				set.headers['x-elysia'] = '1'
			})
			.get('/*', index)
			.get('/u/:id', index)
			.get('/api/users/:id', ({ params }) => `user ${params.id}`)
			.get('/api/static', () => 'static fn')
			.get('/u/me', () => 'me')
			.post('/api/x', () => 'posted')
		app.listen(0)

		try {
			const base = `http://localhost:${app.server!.port}`
			const get = (path: string, init?: RequestInit) =>
				fetch(`${base}${path}`, init)

			const user = await get('/api/users/1')
			expect(await user.text()).toBe('user 1')
			// the hand-off still runs Elysia's hooks
			expect(user.headers.get('x-elysia')).toBe('1')

			expect(await (await get('/api/static')).text()).toBe('static fn')
			expect(await (await get('/u/me')).text()).toBe('me')
			expect(await (await get('/api/x', { method: 'POST' })).text()).toBe(
				'posted'
			)

			for (const path of ['/', '/deep/client/route', '/u/42']) {
				const page = await get(path)
				expect(page.headers.get('content-type')).toStartWith('text/html')
				expect(await page.text()).toContain('id="fixture"')
			}
		} finally {
			await app.stop(true)
		}
	})

	// `bun build --target=bun` turns an HTML import into a plain manifest
	it('recognises a built bundle manifest', () => {
		const manifest = { index: './index.html', files: [] }

		expect(isHTMLBundle(manifest)).toBe(true)
		expect(
			collectStaticRoutes(new Elysia().get('/', manifest) as any)?.['/']
				?.GET
		).toBe(manifest)
	})

	it('never answers `{}` for a bundle it cannot serve', async () => {
		const response = await new Elysia()
			.get('/', index)
			.handle(new Request('http://localhost/'))

		expect(response.status).toBe(500)
		expect(await response.text()).not.toBe('{}')
	})

	it('does not treat a plain `{ index }` object as a bundle', async () => {
		expect(isHTMLBundle({ index: 'home' })).toBe(false)

		const response = await new Elysia()
			.get('/', { index: 'home' })
			.handle(new Request('http://localhost/'))

		expect(await response.json()).toEqual({ index: 'home' })
	})

	// Paths Bun's router reads differently must not be shadowed: optional
	// params, percent-encoded ASCII, non-ASCII, `.all()` and `.mount()` under
	// the SPA fallback
	it('hands off every route shape a wildcard bundle could shadow', async () => {
		const inner = new Elysia().get('/x', () => 'mounted')
		const app = new Elysia()
			.get('/*', index)
			.get('/opt/:id?', ({ params }) => `opt:${params.id ?? '-'}`)
			.get('/sp ace', () => 'space')
			.get('/a|b', () => 'pipe')
			.get('/café', () => 'cafe')
			.all('/any/*', ({ request }) => `any:${request.method}`)
			.mount('/mnt', inner.fetch)
		app.listen(0)

		try {
			const base = `http://localhost:${app.server!.port}`
			const text = async (path: string) =>
				(await fetch(`${base}${path}`)).text()

			expect(await text('/opt')).toBe('opt:-')
			expect(await text('/opt/5')).toBe('opt:5')
			expect(await text('/sp%20ace')).toBe('space')
			expect(await text('/a%7Cb')).toBe('pipe')
			expect(await text('/caf%C3%A9')).toBe('cafe')
			expect(await text('/any/z')).toBe('any:GET')
			expect(await text('/mnt/x')).toBe('mounted')
			expect(await text('/client/route')).toContain('id="fixture"')
		} finally {
			await app.stop(true)
		}
	})

	// `/time/12:30` is static to Elysia but a malformed param to Bun: rather
	// than fail to boot or shadow it, the bundle stays off the native table
	it('boots and keeps a route Bun cannot express', async () => {
		const warn = console.warn
		console.warn = () => {}

		const app = new Elysia()
			.get('/*', index)
			.get('/time/12:30', () => 'lunch')
		try {
			app.listen(0)
			const res = await fetch(
				`http://localhost:${app.server!.port}/time/12:30`
			)
			expect(await res.text()).toBe('lunch')
		} finally {
			console.warn = warn
			await app.stop(true)
		}
	})
})
