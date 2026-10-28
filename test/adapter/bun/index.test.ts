import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../../src'

describe('Bun adapter', () => {
	it('handle query guard', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ a: t.String() })
			})
			.get('/works-with', ({ query }) => 'Works' + query.a)
			.get('/works-without', () => 'Works without')
			.listen(0)

		const query = await fetch(
			`http://localhost:${app.server!.port}/works-with?a=with`
		).then((x) => x.text())

		expect(query).toEqual('Workswith')

		const query2 = await fetch(
			`http://localhost:${app.server!.port}/works-without?a=1`
		).then((x) => x.text())

		expect(query2).toEqual('Works without')
	})

	it('handle merge query guard', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ a: t.String() }),
				schema: 'merge'
			})
			.get('/works-with', ({ query }) => 'Works' + query.a)
			.get('/works-without', () => 'Works without')
			.listen(0)

		const query = await fetch(
			`http://localhost:${app.server!.port}/works-with?a=with`
		).then((x) => x.text())

		expect(query).toEqual('Workswith')

		const query2 = await fetch(
			`http://localhost:${app.server!.port}/works-without?a=1`
		).then((x) => x.text())

		expect(query2).toEqual('Works without')
	})

	it('runs an always-global request hook through Bun.serve and app.handle', async () => {
		let caughtError: Error | undefined

		const app = new Elysia()
			.headers({
				'x-header': 'test'
			})
			.onError(({ error }) => {
				caughtError = error as Error

				return 'handled'
			})
			.onRequest(({ set }) => {
				set.status = 400

				throw new Error('A')
			})
			.get('/', 'yay')
			.listen(0)

		const response = await fetch(`http://localhost:${app.server!.port}`)

		const text = await response.text()

		expect(text).toBe('handled')
		expect(response.status).toBe(400)
		expect(response.headers.get('x-header')).toBe('test')
		expect(caughtError?.message).toBe('A')

		const handled = await app.handle(new Request('http://localhost/'))
		await expect(handled.text()).resolves.toBe('handled')
		expect(handled.status).toBe(400)
	})

	it('handle non-ASCII path', async () => {
		const app = new Elysia().get('/สวัสดี', 'สบายดีไหม').listen(0)

		const response = await fetch(
			`http://localhost:${app.server!.port}/สวัสดี`
		)
		const text = await response.text()
		expect(text).toBe('สบายดีไหม')
	})

	it('serves app.server.fetch() during the start-up gate', async () => {
		// Bun passes no server argument to a programmatic fetch(); the gate
		// must not mistake that for a cancelled epoch
		const app = new Elysia().get('/', () => 'hi').listen(0)

		try {
			const response = await app.server!.fetch(
				new Request('http://localhost/')
			)

			expect(response.status).toBe(200)
			expect(await response.text()).toBe('hi')
		} finally {
			await app.stop(true)
		}
	})

	it("keeps Bun's own error handler after publish on a plain app", async () => {
		// reload() keeps an omitted `error`: the gate's 503 responder must not
		// outlive the gate, or a throwing wrap becomes a silent 503. Bun's
		// default handler reports the throw as an uncaught test error, so the
		// app runs in a child process
		const proc = Bun.spawn(
			[
				'bun',
				'run',
				new URL('./error-handler.fixture.ts', import.meta.url).pathname
			],
			{ stdout: 'pipe', stderr: 'pipe' }
		)
		const stdout = await new Response(proc.stdout).text()
		await proc.exited

		expect(stdout).toContain('STATUS=500')
	})
})
