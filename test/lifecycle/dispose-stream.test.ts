import { describe, expect, it } from 'bun:test'
import { Elysia, bytes, sse } from '../../src'

// A returned ReadableStream is read after the handler returns. Releasing its
// resources (derive dispose, defer, afterResponse) before the body is read
// truncates the response silently: a CSV export over a DB cursor streams 200
// with an empty body.

const rows = (log: string[], resource: { closed: boolean }) =>
	new ReadableStream<string>({
		start() {
			log.push('start')
		},
		async pull(controller) {
			await Bun.sleep(1)
			controller.enqueue(`closed=${resource.closed}\n`)
			controller.close()
			log.push('drained')
		}
	})

describe('resources outlive a returned ReadableStream', () => {
	it('disposes a derived value after the body is read', async () => {
		const log: string[] = []
		const app = new Elysia()
			.derive(() => ({
				db: {
					closed: false,
					[Symbol.dispose]() {
						this.closed = true
						log.push('dispose')
					}
				}
			}))
			.get('/csv', ({ db }) => rows(log, db))

		const res = await app.handle(new Request('http://localhost/csv'))
		expect(await res.text()).toBe('closed=false\n')
		await Bun.sleep(1)
		expect(log).toEqual(['start', 'drained', 'dispose'])
	})

	it('runs defer() after the body is read', async () => {
		const log: string[] = []
		const resource = { closed: false }
		const app = new Elysia().get('/csv', ({ defer }) => {
			defer(() => {
				resource.closed = true
				log.push('defer')
			})

			return rows(log, resource)
		})

		const res = await app.handle(new Request('http://localhost/csv'))
		expect(await res.text()).toBe('closed=false\n')
		await Bun.sleep(1)
		expect(log).toEqual(['start', 'drained', 'defer'])
	})

	it('runs afterResponse after the body is read', async () => {
		const log: string[] = []
		const resource = { closed: false }
		const app = new Elysia()
			.afterResponse(() => {
				resource.closed = true
				log.push('afterResponse')
			})
			.get('/csv', () => rows(log, resource))

		const res = await app.handle(new Request('http://localhost/csv'))
		expect(await res.text()).toBe('closed=false\n')
		await Bun.sleep(1)
		expect(log).toEqual(['start', 'drained', 'afterResponse'])
	})

	it('disposes when the client cancels the body', async () => {
		let disposed = false
		let cancelled = false
		const app = new Elysia()
			.derive(() => ({
				db: {
					[Symbol.dispose]() {
						disposed = true
					}
				}
			}))
			.get(
				'/csv',
				() =>
					new ReadableStream({
						pull: () => new Promise(() => {}),
						cancel() {
							cancelled = true
						}
					})
			)

		const res = await app.handle(new Request('http://localhost/csv'))
		await res.body!.cancel()
		await Bun.sleep(1)
		expect(cancelled).toBe(true)
		expect(disposed).toBe(true)
	})

	it('keeps an sse stream an event stream', async () => {
		const app = new Elysia().afterResponse(() => {}).get('/sse', () =>
			sse(
				new ReadableStream({
					start(controller) {
						controller.enqueue('a')
						controller.close()
					}
				})
			)
		)

		const res = await app.handle(new Request('http://localhost/sse'))
		expect(res.headers.get('content-type')).toBe('text/event-stream')
		expect(await res.text()).toBe('data: a\n\n')
	})

	// The observer drains a finite source on its own, like the generator tee:
	// an in-process caller that never reads the body, or a hook that replaces
	// the stream, must not skip cleanup
	it('releases when the body is never read', async () => {
		let disposed = false
		const app = new Elysia()
			.derive(() => ({
				db: {
					[Symbol.dispose]() {
						disposed = true
					}
				}
			}))
			.get('/csv', () => rows([], { closed: false }))

		await app.handle(new Request('http://localhost/csv'))
		await Bun.sleep(10)
		expect(disposed).toBe(true)
	})

	it('releases when a hook replaces the stream', async () => {
		const log: string[] = []
		const app = new Elysia()
			.afterResponse(() => {
				log.push('afterResponse')
			})
			.mapResponse(() => new Response('replaced'))
			.get('/csv', () => rows([], { closed: false }))

		const res = await app.handle(new Request('http://localhost/csv'))
		expect(await res.text()).toBe('replaced')
		await Bun.sleep(10)
		expect(log).toEqual(['afterResponse'])
	})

	// `bytes()` promises the exact stream reaches the response
	it('leaves a bytes() stream certified', async () => {
		const app = new Elysia()
			.afterResponse(() => {})
			.get('/bin', () =>
				bytes(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1, 2]))
							controller.close()
						}
					})
				)
			)

		const res = await app.handle(new Request('http://localhost/bin'))
		expect(res.headers.get('content-type')).toBe('application/octet-stream')
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(
			new Uint8Array([1, 2])
		)
	})
})
