import { describe, it, expect, afterEach, spyOn } from 'bun:test'

import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { createTracer, unionTracePhases } from '../../src/trace'
import { compileHandler } from '../../src/compile/handler'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const MISSING = 'requires the trace capability'

const compileFirst = (app: Elysia<any, any>) => {
	const route = (app as any)['~routes']![0]
	return compileHandler(route as any, app as any)
}

describe('trace capability', () => {
	describe('missing capability throws at first router build', () => {
		it('throws on .compile()', () => {
			const app = new Elysia().trace(() => {}).get('/', () => 'ok')
			expect(() => app.compile()).toThrow(MISSING)
		})

		it('throws when the fetch handler is materialised', () => {
			const app = new Elysia().trace(() => {}).get('/', () => 'ok')
			expect(() => void app.fetch).toThrow(MISSING)
		})

		it('rolls back listen()', async () => {
			const app = new Elysia().trace(() => {}).get('/', () => 'ok')
			try {
				app.listen(0)
				await Bun.sleep(0)
				expect(app.server).toBeUndefined()
			} finally {
				;(app as any).server?.stop?.()
			}
		})

		it('guard-carried trace hooks also trip the throw', () => {
			const app = new Elysia()
				.guard({ trace: () => {} } as any)
				.get('/', () => 'ok')
			expect(() => app.compile()).toThrow(MISSING)
		})
	})

	describe('registered capability builds and traces', () => {
		it('root .use(trace()) + .trace() runs the tracer', async () => {
			let fired = false
			const app = new Elysia()
				.use(trace())
				.trace(({ onHandle }) => {
					onHandle(() => {
						fired = true
					})
				})
				.get('/', () => 'ok')

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
			expect(fired).toBe(true)
		})

		it('a scoped plugin registering trace propagates to the root', async () => {
			const provider = new Elysia().use(trace())
			const app = new Elysia()
				.use(provider)
				.trace(() => {})
				.get('/', () => 'ok')

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
		})

		it('guard-carried trace builds when the capability is present', async () => {
			const app = new Elysia()
				.use(trace())
				.guard({ trace: () => {} } as any)
				.get('/', () => 'ok')

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
		})
	})

	describe('scope-child visibility', () => {
		it('parent capability reaches an async grouped child with trace', async () => {
			let fired = false
			const app = new Elysia().use(trace()).group('/api', (group) =>
				group
					.trace(({ onHandle }) => {
						onHandle(() => {
							fired = true
						})
					})
					.get('/x', () => 'ok')
			)

			const res = await app.handle(new Request('http://localhost/api/x'))
			expect(res.status).toBe(200)
			expect(fired).toBe(true)
		})

		it('parent capability reaches an async plugin child with trace', async () => {
			const app = new Elysia().use(trace()).use(async (inner) => {
				inner.trace(() => {}).get('/async', () => 'ok')
			})
			await (app as any).modules

			const res = await app.handle(new Request('http://localhost/async'))
			expect(res.status).toBe(200)
		})

		it('a child registering the capability lets root routes trace', async () => {
			const app = new Elysia()
				.use(async (inner) => {
					inner.use(trace())
				})
				.trace(() => {})
				.get('/', () => 'ok')
			await (app as any).modules

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
		})
	})

	describe('dual-package detection', () => {
		// it('warns naming both provider ids when a second, non-identical provider merges', () => {
		// 	// Simulate a duplicate install: a registrar with the SAME name but a
		// 	// different seed (so it bypasses the name+seed checksum dedup) carrying
		// 	// a distinct provider identity.
		// 	const secondProvider = {
		// 		id: '@elysia/trace@duplicate-copy',
		// 		createTracer,
		// 		unionTracePhases
		// 	}
		// 	const secondRegistrar = () => {
		// 		const app = new Elysia({
		// 			name: '@elysia/trace',
		// 			seed: secondProvider.id
		// 		})
		// 		;(app as any)['~ext'] = {
		// 			capability: { trace: { provider: secondProvider } }
		// 		}
		// 		return app
		// 	}

		// 	const warn = spyOn(console, 'warn').mockImplementation(() => {})
		// 	try {
		// 		new Elysia().use(trace()).use(secondRegistrar())

		// 		expect(warn).toHaveBeenCalled()
		// 		const message = warn.mock.calls[0]!.join(' ')
		// 		expect(message).toContain('Duplicate trace capability')
		// 		expect(message).toContain('@elysia/trace@duplicate-copy')
		// 	} finally {
		// 		warn.mockRestore()
		// 	}
		// })

		it('identical registrations dedup silently (no warn)', () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			try {
				new Elysia().use(trace()).use(trace()).use(trace())
				expect(warn).not.toHaveBeenCalled()
			} finally {
				warn.mockRestore()
			}
		})
	})

	describe('direct compiler path (unsealed, no seal)', () => {
		it('compiles a traced route when the capability is registered', () => {
			const app = new Elysia()
				.use(trace())
				.trace(() => {})
				.get('/', () => 'ok')

			const compiled = compileFirst(app)
			expect(typeof compiled).toBe('function')
		})

		it('throws on direct compile when the capability is missing', () => {
			const app = new Elysia().trace(() => {}).get('/', () => 'ok')
			expect(() => compileFirst(app)).toThrow(MISSING)
		})
	})
})
