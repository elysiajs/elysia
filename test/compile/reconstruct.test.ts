import { describe, it, expect } from 'bun:test'

import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { Reconstrct } from '../../src/compile/handler/reconstruct'

// `Reconstrct.trace` is only reached by the AOT-reconstructed handler path
// (`reconstructed.a.includes('tr')` in src/compile/handler/index.ts), which
// the ordinary JIT compile path never exercises. It's a plain exported static
// method, so it's unit-tested directly here rather than through the full
// capture/manifest/reconstruct machinery (see test/aot/_manifest.ts).
describe('Reconstrct.trace', () => {
	it('returns undefined when the route has no trace hooks', () => {
		const app = new Elysia()

		expect(Reconstrct.trace({} as any, app as any)).toBeUndefined()
	})

	it('returns an empty trace array as-is without requiring a provider', () => {
		const app = new Elysia()
		const hook = { trace: [] as any[] }

		// no `.use(trace())` on `app`: this must not throw despite the
		// missing capability, since there is nothing to map
		expect(Reconstrct.trace(hook as any, app as any)).toBe(hook.trace)
	})

	it('throws when trace hooks exist but no trace() capability is registered', () => {
		const app = new Elysia()
		const hook = { trace: [() => {}] }

		expect(() => Reconstrct.trace(hook as any, app as any)).toThrow(
			'requires the trace capability'
		)
	})

	it('maps each trace handler into a tracer via the registered provider', () => {
		const app = new Elysia().use(trace())
		const first = () => {}
		const second = () => {}
		const hook = { trace: [first, second] }

		const tracers = Reconstrct.trace(hook as any, app as any)

		expect(Array.isArray(tracers)).toBe(true)
		expect(tracers).toHaveLength(2)
		for (const tracer of tracers) expect(typeof tracer).toBe('function')
	})
})
