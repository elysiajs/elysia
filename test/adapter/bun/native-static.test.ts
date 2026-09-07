// @ts-nocheck
import { Elysia, t, status } from '../../../src'
import { afterEach, describe, expect, it } from 'bun:test'

// These cover the runtime half of native static promotion: a promoted route is
// installed into Bun's own route table and answered *before* `app.fetch` is
// reached, so a bypass here is invisible to `app.handle()` and only shows up
// against a real server.

let server: Elysia | undefined

const listen = (app: Elysia, port: number) => {
	server = app.listen({ hostname: '127.0.0.1', port })

	return `http://127.0.0.1:${port}`
}

afterEach(() => {
	server?.stop()
	server = undefined
})

const authorize = ({ request }: any) => {
	if (request?.headers.get('authorization') !== 'Bearer secret')
		return status(401, 'DENY')
}

describe('Bun Native Static Response', () => {
	// `onRequest` runs before routing, so it is the only place an app can put a
	// blanket auth or rate limit boundary. A literal route must not be able to
	// answer around it, whichever order the two were declared in - the hook may
	// be registered long after the route was already promoted.
	describe('an app-level request hook guards literal routes', () => {
		const orders = {
			'hook before route': () =>
				new Elysia().onRequest(authorize).get('/secret', 'TOP_SECRET'),
			'route before hook': () =>
				new Elysia().get('/secret', 'TOP_SECRET').onRequest(authorize),
			'hook on parent, route in plugin': () =>
				new Elysia()
					.onRequest(authorize)
					.use(new Elysia().get('/secret', 'TOP_SECRET')),
			'hook in plugin, route after': () =>
				new Elysia()
					.use(new Elysia({ name: 'auth' }).onRequest(authorize))
					.get('/secret', 'TOP_SECRET')
		}

		let port = 8420

		for (const [name, build] of Object.entries(orders))
			it(`reject an unauthorized request - ${name}`, async () => {
				const url = listen(build(), port++)

				const denied = await fetch(`${url}/secret`)
				expect(denied.status).toBe(401)
				expect(await denied.text()).toBe('DENY')

				const allowed = await fetch(`${url}/secret`, {
					headers: { authorization: 'Bearer secret' }
				})
				expect(allowed.status).toBe(200)
				expect(await allowed.text()).toBe('TOP_SECRET')
			})

		it('treat a literal route exactly like a function route', async () => {
			const url = listen(
				new Elysia()
					.onRequest(authorize)
					.get('/literal', 'SECRET')
					.get('/function', () => 'SECRET'),
				port++
			)

			expect((await fetch(`${url}/literal`)).status).toBe(
				(await fetch(`${url}/function`)).status
			)
		})
	})

	// Independent of any hook: a route schema is the only thing validating
	// headers, query and cookies, and a promoted route skipped all of it.
	it('enforce a request schema on a literal route with no hook present', async () => {
		const url = listen(
			new Elysia()
				.get('/headers', 'HEADERS', {
					headers: t.Object({
						authorization: t.Literal('Bearer secret')
					})
				})
				.get('/query', 'QUERY', {
					query: t.Object({ id: t.Numeric() })
				}),
			8440
		)

		expect((await fetch(`${url}/headers`)).status).toBe(422)
		expect((await fetch(`${url}/query`)).status).toBe(422)

		expect(
			(
				await fetch(`${url}/headers`, {
					headers: { authorization: 'Bearer secret' }
				})
			).status
		).toBe(200)
		expect((await fetch(`${url}/query?id=1`)).status).toBe(200)
	})

	// A higher order function wraps `fetch`, so a natively answered route never
	// reaches it either.
	it('run a higher order function for a literal route', async () => {
		let wrapped = 0

		const url = listen(
			new Elysia()
				.wrap((fn) => (request) => {
					wrapped++

					return fn(request)
				})
				.get('/', 'Static Content'),
			8441
		)

		expect(await (await fetch(url)).text()).toBe('Static Content')
		expect(wrapped).toBe(1)
	})

	// Same class as the request hook: `trace` is installed app-wide and may be
	// registered after the route was already promoted.
	it('run trace for a literal route registered before it', async () => {
		let traced = 0

		const url = listen(
			new Elysia().get('/', 'Static Content').trace(() => {
				traced++
			}),
			8443
		)

		expect(await (await fetch(url)).text()).toBe('Static Content')
		expect(traced).toBe(1)
	})

	// Non-vacuity: the guard must still let an ordinary literal route be served
	// natively. `onAfterResponse` only runs inside the composed handler, so its
	// absence for `/literal` - next to its presence for `/function` - is proof
	// that `/literal` really was answered from the native route table and not
	// merely that it returned 200.
	it('keep serving a route natively when nothing can intercept it', async () => {
		const seen: string[] = []

		const url = listen(
			new Elysia()
				.onStart(() => {})
				.onError(() => {})
				.onAfterResponse(({ path }) => {
					seen.push(path)
				})
				.get('/literal', 'Static Content', {
					detail: { summary: 'home' },
					tags: ['static']
				})
				.get('/function', () => 'Dynamic Content'),
			8442
		)

		expect(await (await fetch(`${url}/literal`)).text()).toBe(
			'Static Content'
		)
		expect(await (await fetch(`${url}/function`)).text()).toBe(
			'Dynamic Content'
		)

		await Bun.sleep(50)

		expect(seen).toEqual(['/function'])
	})
})
