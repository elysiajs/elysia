import { describe, it, expect, afterEach, spyOn } from 'bun:test'

import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import {
	buildWSRoute,
	buildGlobalWSHandler,
	resolveWSOptions,
	accumulateWSOptions
} from '../../src/ws/route'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const MISSING = 'requires the WebSocket capability'

describe('websocket capability', () => {
	describe('missing capability throws at first router build', () => {
		it('throws on .compile()', () => {
			const app = new Elysia().ws('/ws', { message() {} })
			expect(() => app.compile()).toThrow(MISSING)
		})

		it('throws when the fetch handler is materialised', () => {
			const app = new Elysia().ws('/ws', { message() {} })
			expect(() => void app.fetch).toThrow(MISSING)
		})

		it('throws on listen()', () => {
			const app = new Elysia().ws('/ws', { message() {} })
			try {
				expect(() => app.listen(0)).toThrow(MISSING)
			} finally {
				;(app as any).server?.stop?.()
			}
		})

		it('an inherited (guard/plugin) WS route also trips the throw', () => {
			const plugin = new Elysia().ws('/plugin', { message() {} })
			const app = new Elysia().use(plugin).get('/', () => 'ok')
			expect(() => app.compile()).toThrow(MISSING)
		})
	})

	describe('registered capability builds', () => {
		it('root .use(websocket()) + .ws() compiles', () => {
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', { message() {} })
			expect(() => app.compile()).not.toThrow()
		})

		it('a self-contained plugin (capability + WS routes) works when the host imports nothing', () => {
			// cf. test/ws/message.test.ts "should send from plugin"
			const plugin = new Elysia().use(websocket()).ws('/chat', {
				message(ws, message) {
					;(ws as any).send(message)
				}
			})
			const app = new Elysia().use(plugin).get('/', () => 'ok')
			expect(() => app.compile()).not.toThrow()
		})

		it('a scoped plugin registering the capability propagates to the root', () => {
			const provider = new Elysia().use(websocket())
			const app = new Elysia().use(provider).ws('/ws', { message() {} })
			expect(() => app.compile()).not.toThrow()
		})
	})

	describe('options precedence (deep plugin < root < per-route)', () => {
		it('resolves shallower-wins with a warning at each conflict layer', () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			try {
				const deep = new Elysia().use(
					websocket({ idleTimeout: 10, maxPayloadLength: 111 })
				)
				const app = new Elysia()
					.use(deep) // deeper (loses to root on idleTimeout)
					.use(websocket({ idleTimeout: 20 })) // root registration
					.ws('/x', { idleTimeout: 30, message() {} }) // per-route

				app.compile()

				const config = app['~wsConfig'] as any
				// per-route override wins for idleTimeout
				expect(config.idleTimeout).toBe(30)
				// deep-only key survives (never overridden)
				expect(config.maxPayloadLength).toBe(111)

				// one warn from resolveOptions (deep 10 vs root 20) and one from
				// per-route accumulation (base 20 vs route 30) — a warn per layer.
				const messages = warn.mock.calls.map((c) => c.join(' '))
				const idleWarns = messages.filter((m) =>
					m.includes('idleTimeout')
				)
				expect(idleWarns.length).toBeGreaterThanOrEqual(2)
			} finally {
				warn.mockRestore()
			}
		})

		it('bare .use(websocket()) with no options and a plain route yields no config', () => {
			const app = new Elysia()
				.use(websocket())
				.ws('/x', { message() {} })
			app.compile()
			expect(app['~wsConfig']).toBeUndefined()
		})
	})

	describe('registration dedup & dual-package detection', () => {
		it('identical double-registration is silent (name+seed checksum dedup)', () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			try {
				new Elysia()
					.use(websocket({ idleTimeout: 5 }))
					.use(websocket({ idleTimeout: 5 }))
					.use(websocket({ idleTimeout: 5 }))
					.ws('/x', { message() {} })
					.compile()
				expect(warn).not.toHaveBeenCalled()
			} finally {
				warn.mockRestore()
			}
		})

		// it('a dual-package provider warns naming both ids', () => {
		// 	const secondProvider = {
		// 		id: '@elysia/websocket@duplicate-copy',
		// 		buildWSRoute,
		// 		buildGlobalWSHandler,
		// 		resolveOptions: resolveWSOptions,
		// 		accumulateOptions: accumulateWSOptions
		// 	}
		// 	const secondRegistrar = () => {
		// 		const app = new Elysia({
		// 			name: '@elysia/websocket',
		// 			seed: secondProvider.id
		// 		})
		// 		;(app as any)['~ext'] = {
		// 			capability: { ws: { provider: secondProvider } }
		// 		}
		// 		return app
		// 	}

		// 	const warn = spyOn(console, 'warn').mockImplementation(() => {})
		// 	try {
		// 		new Elysia().use(websocket()).use(secondRegistrar())

		// 		// expect(warn).toHaveBeenCalled()
		// 		// const message = warn.mock.calls[0]!.join(' ')
		// 		// expect(message).toContain('Duplicate WebSocket capability')
		// 		// expect(message).toContain('@elysia/websocket@duplicate-copy')
		// 	} finally {
		// 		warn.mockRestore()
		// 	}
		// })

		it('diamond re-append dedups by origin (single options entry)', () => {
			const shared = websocket({ idleTimeout: 42 })
			const left = new Elysia().use(shared)
			const right = new Elysia().use(shared)
			const app = new Elysia()
				.use(left)
				.use(right)
				.ws('/x', { message() {} })
			app.compile()
			// Both diamond arms carry the same origin → one effective value.
			expect((app['~wsConfig'] as any).idleTimeout).toBe(42)
		})
	})

	describe('rebuild-failure leaves no WS config residue', () => {
		it('a successful build commits ~wsConfig; a failed build commits nothing', () => {
			const ok = new Elysia()
				.use(websocket({ idleTimeout: 77 }))
				.ws('/x', { maxPayloadLength: 256, message() {} })
			ok.compile()
			expect(ok['~wsConfig']).toEqual({
				idleTimeout: 77,
				maxPayloadLength: 256
			} as any)

			// A WS app that also uses trace without the trace capability: the
			// resolve throws at the START of the build, before any WS
			// accumulation, so `~wsConfig` is never committed (no residue).
			const bad = new Elysia()
				.use(websocket({ idleTimeout: 99 }))
				.trace(() => {})
				.ws('/x', { idleTimeout: 12, message() {} })
			expect(() => bad.compile()).toThrow('trace capability')
			expect(bad['~wsConfig']).toBeUndefined()
		})
	})

	describe('pending-plugin / async-drain (adapter delayed publication)', () => {
		it('capability defaults AND per-route overrides appear in server.reload(serve).websocket', async () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			let reloaded = false
			let reloadServe: any
			const serveSpy = spyOn(Bun, 'serve').mockImplementation(
				((options: any) => {
					const server: any = {
						hostname: 'localhost',
						port: 0,
						reload(next: any) {
							reloaded = true
							reloadServe = next
						},
						stop() {}
					}
					return server
				}) as any
			)

			try {
				const app = new Elysia()
					.use(websocket({ idleTimeout: 100, backpressureLimit: 999 }))
					.use(async (inner) => {
						inner.ws('/room', {
							idleTimeout: 60,
							maxPayloadLength: 2048,
							message() {}
						})
					})

				app.listen(0)

				for (let i = 0; i < 400 && !reloaded; i++)
					await new Promise((r) => setTimeout(r, 5))

				expect(reloaded).toBe(true)
				const ws = reloadServe.websocket
				expect(ws).toBeDefined()
				// per-route override wins
				expect(ws.idleTimeout).toBe(60)
				// route-only key present
				expect(ws.maxPayloadLength).toBe(2048)
				// app-wide default (not overridden) survives to publication
				expect(ws.backpressureLimit).toBe(999)
				// the global lifecycle handler is present
				expect(typeof ws.message).toBe('function')
			} finally {
				serveSpy.mockRestore()
				warn.mockRestore()
			}
		})
	})
})
