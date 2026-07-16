import { describe, it, expect } from 'bun:test'
import { tee } from '../../src/adapter/utils'
import { Elysia } from '../../src'

describe('tee() bounded drain-ahead', () => {
	it('caps how far the producer races ahead of the slowest branch', async () => {
		let produced = 0
		async function* src() {
			while (true) {
				produced++
				yield produced
			}
		}

		const cap = 4
		const [client, listener] = await tee(src(), 2, cap)

		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		for (let i = 0; i < 3; i++) await client.next()
		await new Promise((r) => setTimeout(r, 20))

		// One source read may already be in flight.
		expect(produced).toBeLessThanOrEqual(3 + cap + 1)

		await client.return?.()
		await drained
	})

	it('drains streams shorter than the cap eagerly (server-timing preserved)', async () => {
		async function* src() {
			for (let i = 0; i < 3; i++) yield i
		}

		const [response, listener] = await tee(src(), 2, 64)

		const seen: number[] = []
		for await (const v of listener) seen.push(v)
		expect(seen).toEqual([0, 1, 2])

		const got: number[] = []
		for await (const v of response) got.push(v)
		expect(got).toEqual([0, 1, 2])
	})

	it('caps the window in bytes, not just entries', async () => {
		let produced = 0
		async function* megachunks() {
			while (true) {
				produced++
				yield new Uint8Array(1024 * 1024)
			}
		}

		const [client, listener] = await tee(megachunks(), 2)

		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		await client.next()
		await new Promise((r) => setTimeout(r, 30))

		expect(produced).toBeLessThanOrEqual(8)

		await client.return?.()
		await drained
	})

	it('does not wedge when consumers exceed the default byte cap', async () => {
		async function* megachunks() {
			for (let i = 0; i < 30; i++) yield new Uint8Array(1024 * 1024)
		}

		const [a, b] = await tee(megachunks(), 2)

		const count = (branch: AsyncIterableIterator<unknown>) =>
			(async () => {
				let n = 0
				for await (const _ of branch) n++
				return n
			})()

		const counts = (await Promise.race([
			Promise.all([count(a), count(b)]),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('tee wedged')), 1000)
			)
		])) as number[]

		expect(counts).toEqual([30, 30])
	})

	it('streams every chunk of a large-chunk response and fires afterResponse once (end to end)', async () => {
		let afterResponse = 0

		const app = new Elysia()
			.afterResponse(() => {
				afterResponse++
			})
			.get('/big', async function* () {
				for (let i = 0; i < 30; i++) yield new Uint8Array(1024 * 1024)
			})

		const res = await app.handle(new Request('http://localhost/big'))
		const reader = res.body!.getReader()

		const received = (await Promise.race([
			(async () => {
				let n = 0
				while (true) {
					const { done } = await reader.read()
					if (done) break
					n++
				}
				return n
			})(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('response wedged')), 2000)
			)
		])) as number

		await new Promise((r) => setTimeout(r, 20))
		expect(received).toBe(30)
		expect(afterResponse).toBe(1)
	})

	it('unwinds on branch-0 return while the source is stalled', async () => {
		let observerDone = false
		let hang!: () => void

		async function* stalled() {
			yield 'first'
			await new Promise<void>((resolve) => {
				hang = resolve
			})
			yield 'never'
		}

		const [client, listener] = await tee(stalled(), 2)

		const drained = (async () => {
			for await (const _ of listener) {
			}
			observerDone = true
		})()

		await client.next()
		await client.return?.()

		await Promise.race([
			drained,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('observer wedged')), 500)
			)
		])
		expect(observerDone).toBe(true)
		hang()
	})

	it('fires afterResponse when the client aborts a stalled stream (end to end)', async () => {
		let afterResponse = 0
		let hang!: () => void

		const app = new Elysia()
			.afterResponse(() => {
				afterResponse++
			})
			.get('/sse', async function* () {
				yield 'first'
				await new Promise<void>((resolve) => {
					hang = resolve
				})
				yield 'never'
			})

		const controller = new AbortController()
		const res = await app.handle(
			new Request('http://localhost/sse', { signal: controller.signal })
		)
		const reader = res.body!.getReader()
		await reader.read()
		controller.abort()
		try {
			await reader.cancel()
		} catch {}

		await new Promise((r) => setTimeout(r, 200))
		expect(afterResponse).toBe(1)
		hang()
	})

	it('propagates a source error to every branch', async () => {
		async function* failing() {
			yield 1
			throw new Error('boom')
		}

		const [a, b] = await tee(failing(), 2)

		expect((await a.next()).value).toBe(1)
		await expect(a.next()).rejects.toThrow('boom')

		const drain = async () => {
			for await (const _ of b) {
			}
		}
		await expect(drain()).rejects.toThrow('boom')
	})

	it('charges Blob chunks against the byte cap by size', async () => {
		let produced = 0
		async function* megabyteBlobs() {
			while (true) {
				produced++
				yield new Blob([
					new Uint8Array(1 << 20)
				]) as unknown as Uint8Array
			}
		}

		const [client, listener] = tee(megabyteBlobs(), 2, 1 << 20, 1 << 22)
		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		await client.next()
		await Promise.resolve()

		expect(produced).toBeLessThanOrEqual(6)

		await client.return?.()
		await drained
	})
})
