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
		const [client, listener] = await tee(src(), cap)

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

		const [response, listener] = await tee(src(), 64)

		// the listener only waits for the end, values go to the response
		const seen: number[] = []
		for await (const v of listener) seen.push(v)
		expect(seen).toEqual([])

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

		const [client, listener] = await tee(megachunks())

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

		const [a, b] = await tee(megachunks())

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

		// the second branch is a completion signal, it yields no values
		expect(counts).toEqual([30, 0])
	})

	it('streams every chunk of a large-chunk response and fires afterResponse once (end to end)', async () => {
		let afterResponse = 0

		const app = new Elysia()
			.onAfterResponse(() => {
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

		const [client, listener] = await tee(stalled())

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
			.onAfterResponse(() => {
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

		const [a, b] = await tee(failing())

		expect((await a.next()).value).toBe(1)
		await expect(a.next()).rejects.toThrow('boom')

		const drain = async () => {
			for await (const _ of b) {
			}
		}
		await expect(drain()).rejects.toThrow('boom')
	})

	// afterResponse and dispose wait on the second branch: it must not settle
	// while the source can still produce, and must settle once it ends
	it('settles the completion branch exactly when the source ends', async () => {
		let release!: () => void
		async function* gated() {
			yield 1
			await new Promise<void>((resolve) => {
				release = resolve
			})
			yield 2
		}

		const [value, completion] = tee(gated())
		let settled = false
		const end = completion.next().then((r) => {
			settled = true
			return r
		})

		expect((await value.next()).value).toBe(1)
		await new Promise((r) => setTimeout(r, 10))
		expect(settled).toBe(false)

		release()
		expect(await end).toEqual({ done: true, value: undefined })
		expect((await value.next()).value).toBe(2)
		expect((await value.next()).done).toBe(true)
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

		const [client, listener] = tee(megabyteBlobs(), 1 << 20, 1 << 22)
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
