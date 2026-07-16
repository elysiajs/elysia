import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const req = (path = '/', init?: RequestInit) =>
	new Request('http://e.ly' + path, init)

describe('response lifecycle resources', () => {
	it('uses queueMicrotask for compiled afterResponse scheduling', async () => {
		const originalQueueMicrotask = globalThis.queueMicrotask
		const originalSetImmediate = globalThis.setImmediate
		let microtasks = 0
		let immediates = 0

		globalThis.queueMicrotask = ((fn) => {
			microtasks++
			return originalQueueMicrotask(fn)
		}) as typeof queueMicrotask

		globalThis.setImmediate = ((fn: (...args: any[]) => void) => {
			immediates++
			return originalSetImmediate(fn)
		}) as typeof setImmediate

		try {
			let ran = false

			const app = new Elysia()
				.afterResponse(() => {
					ran = true
				})
				.get('/', () => 'ok')

			await app.handle(req())
			await Bun.sleep(1)

			expect(ran).toBe(true)
			expect(microtasks).toBeGreaterThan(0)
			expect(immediates).toBe(0)
		} finally {
			globalThis.queueMicrotask = originalQueueMicrotask
			globalThis.setImmediate = originalSetImmediate
		}
	})

	it('removes stream abort listeners when a response stream completes normally', async () => {
		const controller = new AbortController()
		const signal = controller.signal as AbortSignal & {
			addEventListener: AbortSignal['addEventListener']
			removeEventListener: AbortSignal['removeEventListener']
		}
		const addEventListener = signal.addEventListener.bind(signal)
		const removeEventListener = signal.removeEventListener.bind(signal)
		let added = 0
		let removed = 0

		signal.addEventListener = ((type, listener, options) => {
			if (type === 'abort') added++

			return addEventListener(type, listener, options)
		}) as AbortSignal['addEventListener']

		signal.removeEventListener = ((type, listener, options) => {
			if (type === 'abort') removed++

			return removeEventListener(type, listener, options)
		}) as AbortSignal['removeEventListener']

		const app = new Elysia().get('/', async function* () {
			yield 'ok'
		})

		const response = await app.handle(req('/', { signal }))

		expect(await response.text()).toBe('ok')
		expect(added).toBe(1)
		expect(removed).toBe(1)
	})
})
