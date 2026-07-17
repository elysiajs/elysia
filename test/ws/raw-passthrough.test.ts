import { describe, it, expect } from 'bun:test'
import { ElysiaWS } from '../../src/ws'

describe('WebSocket raw passthrough getters', () => {
	// Prototype-loop getters: a name-table typo would return undefined
	// instead of a raw-bound method, which no behavioral test would catch.
	it('memoizes raw-bound methods and raw values', () => {
		const methods = [
			'sendText',
			'sendBinary',
			'terminate',
			'publishText',
			'publishBinary',
			'subscribe',
			'unsubscribe',
			'isSubscribed',
			'cork'
		] as const

		const raw: any = {
			data: {},
			remoteAddress: '127.0.0.1',
			binaryType: 'nodebuffer'
		}

		for (const key of methods)
			raw[key] = function (this: unknown) {
				return this === raw
			}

		const ws = new ElysiaWS(raw)

		for (const key of methods) {
			const fn = (ws as any)[key]

			expect(typeof fn).toBe('function')
			// bound to the raw socket, even when detached
			expect(fn()).toBe(true)
			// memoized: same bound function on the next read
			expect((ws as any)[key]).toBe(fn)
		}

		expect(ws.remoteAddress).toBe('127.0.0.1')
		expect(ws.binaryType).toBe('nodebuffer')
	})
})
