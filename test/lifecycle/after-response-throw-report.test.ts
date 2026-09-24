import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

// Every lane must report post-response errors after the response is sent.

const settle = () => Bun.sleep(20)

const capture = async (run: () => Promise<void>) => {
	const reported: unknown[] = []
	const error = console.error
	console.error = (...values: unknown[]) => reported.push(values[0])

	try {
		await run()
		await settle()
	} finally {
		console.error = error
	}

	return reported.filter(
		(value) => value instanceof Error && value.message === 'post-boom'
	)
}

describe('generated afterResponse drain reports failures', () => {
	it('reports a throwing sync afterResponse and still answers 200', async () => {
		let status = 0

		const reported = await capture(async () => {
			const app = new Elysia().get(
				'/',
				{
					afterResponse() {
						throw new Error('post-boom')
					}
				},
				() => 'ok'
			)

			status = (await app.handle('/')).status
		})

		expect(status).toBe(200)
		expect(reported).toHaveLength(1)
	})

	it('reports a throwing async afterResponse', async () => {
		let status = 0

		const reported = await capture(async () => {
			const app = new Elysia().get(
				'/',
				{
					async afterResponse() {
						throw new Error('post-boom')
					}
				},
				() => 'ok'
			)

			status = (await app.handle('/')).status
		})

		expect(status).toBe(200)
		expect(reported).toHaveLength(1)
	})

	it('reports a throwing defer() callback', async () => {
		let status = 0
		let body = ''

		const reported = await capture(async () => {
			const app = new Elysia().get('/', ({ defer }) => {
				defer(() => {
					throw new Error('post-boom')
				})

				return 'ok'
			})

			const response = await app.handle('/')
			status = response.status
			body = await response.text()
		})

		expect(status).toBe(200)
		expect(body).toBe('ok')
		expect(reported).toHaveLength(1)
	})

	it('reports over a real socket', async () => {
		let status = 0

		const reported = await capture(async () => {
			const app = new Elysia().get(
				'/',
				{
					afterResponse() {
						throw new Error('post-boom')
					}
				},
				() => 'ok'
			)

			app.listen(0)

			try {
				const response = await fetch(
					`http://localhost:${app.server!.port}/`
				)
				status = response.status
				await response.text()
				await settle()
			} finally {
				await app.stop(true)
			}
		})

		expect(status).toBe(200)
		expect(reported).toHaveLength(1)
	})

	it('reports the dispatch lane the same way', async () => {
		let status = 0

		const reported = await capture(async () => {
			const app = new Elysia()
				.afterResponse(() => {
					throw new Error('post-boom')
				})
				.get('/', () => 'ok')

			// An unmatched route uses the dispatch lane.
			status = (await app.handle('/nope')).status
		})

		expect(status).toBe(404)
		expect(reported).toHaveLength(1)
	})
})
