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
})
