import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { accumulateWSOptions } from '../../src/ws/route'
import { newWebsocket, wsOpen, wsClosed } from './utils'

describe('WebSocket interleaved messages', () => {
	it('each async message sees its own body across an await', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				async message(ws) {
					const before = ws.body as unknown as string
					// Complete out of order to expose shared message context.
					await Bun.sleep(before === 'slow' ? 40 : 1)
					ws.send(
						JSON.stringify({
							before,
							after: ws.body as unknown as string
						})
					)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got: { before: string; after: string }[] = []
		const done = new Promise<void>((resolve) => {
			ws.onmessage = (e) => {
				got.push(JSON.parse(String(e.data)))
				if (got.length >= 2) resolve()
			}
		})

		ws.send('slow')
		ws.send('fast')
		await done

		for (const r of got) expect(r.after).toBe(r.before)
		expect(got.map((r) => r.before).sort()).toEqual(['fast', 'slow'])

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket per-route option conflict', () => {
	const captureWarn = (run: () => void): string[] => {
		const warnings: string[] = []
		const orig = console.warn
		console.warn = (...a: unknown[]) => warnings.push(a.join(' '))
		try {
			run()
		} finally {
			console.warn = orig
		}
		return warnings
	}

	it('warns when per-route websocket options conflict', () => {
		const warnings = captureWarn(() => {
			const app = new Elysia()
				.use(websocket()).ws('/a', { message() {}, maxPayloadLength: 1024 })
				.use(websocket()).ws('/b', { message() {}, maxPayloadLength: 4096 })
				.compile()
			void app
		})

		expect(
			warnings.some(
				(w) => w.includes('maxPayloadLength') && w.includes('WebSocket')
			)
		).toBe(true)
	})

	it('does not warn when per-route options agree', () => {
		const warnings = captureWarn(() => {
			const app = new Elysia()
				.use(websocket()).ws('/a', { message() {}, maxPayloadLength: 1024 })
				.use(websocket()).ws('/b', { message() {}, maxPayloadLength: 1024 })
				.compile()
			void app
		})

		expect(warnings.some((w) => w.includes('maxPayloadLength'))).toBe(false)
	})

	// Bun exposes one WebSocket config per server, so a per-route value cannot
	// be enforced. Which of two routes registered last is arbitrary, though,
	// and that must not be what decides whether a bound the other route asked
	// for gets relaxed: between routes the strictest limit wins in either
	// order. (App-level config vs a route is a different axis — that
	// precedence is deliberate, see test/plugin/websocket-capability.test.ts.)
	it('keeps the strictest limit whichever route registers first', () => {
		const loose = {
			maxPayloadLength: 4096,
			backpressureLimit: 8192,
			idleTimeout: 120
		}
		const strict = {
			maxPayloadLength: 1024,
			backpressureLimit: 2048,
			idleTimeout: 30
		}

		const looseFirst = {} as any
		const strictFirst = {} as any

		captureWarn(() => {
			accumulateWSOptions(looseFirst, loose as any, '/a')
			accumulateWSOptions(looseFirst, strict as any, '/b')

			accumulateWSOptions(strictFirst, strict as any, '/a')
			accumulateWSOptions(strictFirst, loose as any, '/b')
		})

		expect(looseFirst).toEqual(strict)
		expect(strictFirst).toEqual(strict)
	})

	it('still lets a later route win for non-limit options', () => {
		const target = {} as any

		captureWarn(() => {
			accumulateWSOptions(target, { publishToSelf: false } as any, '/a')
			accumulateWSOptions(target, { publishToSelf: true } as any, '/b')
		})

		expect(target.publishToSelf).toBe(true)
	})
})
