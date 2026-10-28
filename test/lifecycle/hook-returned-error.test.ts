// An `Error` an afterHandle returns goes through the error pipeline like one
// the handler returns. One an error hook returns is served as an unhandled
// error at its own status, never dispatched again (no loop)

import { describe, expect, it } from 'bun:test'
import { Elysia, HTTPError, status } from '../../src'

class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
	readonly detail = 'no funds'
}

const sleep = () => new Promise((resolve) => setTimeout(resolve, 1))

const serve = async (app: Elysia<any, any, any, any, any, any, any, any>) => {
	const response = await app.handle(new Request('http://localhost/'))

	return [response.status, await response.text()] as const
}

describe('afterHandle returning an error', () => {
	// each returns the error on its own lane: sync, async, async tail
	const lanes = {
		sync: () => new OutOfCredit(),
		async: async () => {
			await sleep()
			return new OutOfCredit()
		},
		tail: () => sleep().then(() => new OutOfCredit())
	}

	for (const [lane, afterHandle] of Object.entries(lanes)) {
		const sites = {
			route: (app: Elysia) => app.get('/', { afterHandle }, () => 'ok'),
			instance: (app: Elysia) =>
				app.onAfterHandle(afterHandle).get('/', () => 'ok'),
			guard: (app: Elysia) =>
				app.guard({ afterHandle }).get('/', () => 'ok'),
			macro: (app: Elysia) =>
				app
					.macro({ m: { afterHandle } })
					.get('/', { m: true }, () => 'ok'),
			plugin: (app: Elysia) =>
				app.use(
					new Elysia()
						.onAfterHandle('plugin', afterHandle)
						.get('/', () => 'ok')
				)
		}

		for (const [site, define] of Object.entries(sites))
			it(`serves what the handler returning it does (${site}, ${lane})`, async () => {
				const handler = () => new Elysia().get('/', afterHandle)
				const handled = (app: Elysia) =>
					app.onError(OutOfCredit, () => status(418, 'teapot'))

				expect(await serve(define(new Elysia()) as any)).toEqual(
					await serve(handler())
				)
				expect(
					await serve(define(handled(new Elysia()) as any) as any)
				).toEqual([418, 'teapot'])
			})
	}

	it('ends the afterHandle chain and the success path', async () => {
		const ran: string[] = []
		const app = new Elysia()
			.mapResponse((context) => {
				const { error } = context as { error?: unknown }

				ran.push(error ? 'mapResponse:error' : 'mapResponse')
			})
			.onAfterResponse((context) => {
				const { set, error } = context as typeof context & {
					error?: unknown
				}

				ran.push(`afterResponse:${set.status}:${error === credit}`)
			})
			.get(
				'/',
				{
					afterHandle: [
						() => {
							ran.push('first')
						},
						() => credit,
						() => {
							ran.push('after the error')
						}
					]
				},
				() => 'ok'
			)

		const credit = new OutOfCredit()
		const [code] = await serve(app)
		await sleep()

		expect(code).toBe(402)
		expect(ran).toEqual([
			'first',
			'mapResponse:error',
			'afterResponse:402:true'
		])
	})
})

describe('error hook returning an error', () => {
	const lanes = {
		sync: () => new OutOfCredit(),
		async: async () => {
			await sleep()
			return new OutOfCredit()
		},
		tail: () => sleep().then(() => new OutOfCredit())
	}

	for (const [lane, hook] of Object.entries(lanes))
		it(`serves it at its own status, undispatched (${lane})`, async () => {
			let dispatched = false
			const app = new Elysia()
				.onError(hook)
				.onError(OutOfCredit, () => {
					dispatched = true
					return status(418, 'teapot')
				})
				.get('/', () => {
					throw new Error('caught')
				})
			const unhandled = new Elysia().get('/', () => {
				throw new OutOfCredit()
			})

			expect(await serve(app)).toEqual(await serve(unhandled))
			expect(dispatched).toBe(false)
		})

	it('serves one with no status as a 500, not at the caught status', async () => {
		const app = new Elysia()
			.onError(() => new Error('again'))
			.get('/', () => {
				throw new OutOfCredit()
			})

		const [code, body] = await serve(app)

		expect(code).toBe(500)
		expect(JSON.parse(body)).toMatchObject({
			code: 'internal-server-error',
			status: 500
		})
	})

	it('serves it at its own status before routing too', async () => {
		const app = new Elysia()
			.onError(() => new OutOfCredit())
			.get('/other', () => 'ok')

		expect((await serve(app))[0]).toBe(402)
	})

	it("serves it at its own status from a route's own hook", async () => {
		const app = new Elysia().get(
			'/',
			{ error: () => new OutOfCredit() },
			() => {
				throw new Error('caught')
			}
		)

		expect((await serve(app))[0]).toBe(402)
	})
})
