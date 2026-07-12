/**
 * D2 harness self-test (n-proof.md D2): "a deliberately-skewed lane must be
 * caught." This proves the comparator actually detects divergence — a harness
 * that cannot fail is worthless. It exercises BOTH directions:
 *   • an unskewed lane pair PASSES (compareResponses returns null),
 *   • a header-skew / body-skew / status-skew / set-cookie-skew / observation-
 *     skew each PRODUCE the correct divergence report.
 */

import { describe, it, expect } from 'bun:test'
import { jitHandle, type Lane, type Define } from './lanes'
import {
	snapshot,
	compareResponses,
	compareObservations,
	type ResponseSnapshot
} from './compare'

const ctx = { corpusId: 'self', requestId: 'probe', lanePair: 'self' }

/** Wrap a lane, mutating exactly one facet of its response. */
type Skew = (res: Response) => Response
const skewedLane = async (define: Define, skew: Skew): Promise<Lane> => {
	const inner = await jitHandle.make(define)
	return {
		handle: async (req) => skew(await inner.handle(req)),
		dispose: inner.dispose
	}
}

const define: Define = (app) =>
	app.get('/x', ({ cookie }: any) => {
		cookie.a.value = '1'
		cookie.b.value = '2'
		return 'body-bytes'
	})

const run = async (lane: Lane, path = '/x'): Promise<ResponseSnapshot> => {
	const res = await lane.handle(new Request(`http://localhost${path}`))
	return snapshot(res)
}

describe('D2 self-test — comparator catches injected skew', () => {
	it('unskewed identical lanes PASS (null mismatch)', async () => {
		const a = await jitHandle.make(define)
		const b = await jitHandle.make(define)
		try {
			const m = compareResponses(ctx, await run(a), await run(b))
			expect(m).toBeNull()
		} finally {
			await a.dispose()
			await b.dispose()
		}
	})

	it('catches a flipped body byte and reports component=body', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(define, (res) => {
			// Flip one byte of the body.
			return res.text().then(
				(t) =>
					new Response('X' + t.slice(1), {
						status: res.status,
						headers: res.headers
					})
			) as any
		})
		try {
			// The skew returns a Promise<Response>; resolve it via handle.
			const oSnap = await run(oracle)
			const skewedRes = await skewed.handle(
				new Request('http://localhost/x')
			)
			const cSnap = await snapshot(skewedRes)
			const m = compareResponses(ctx, oSnap, cSnap)
			expect(m?.component).toBe('body')
			expect(m?.oracle).toContain('body-bytes')
			expect(m?.candidate).toContain('Xody-bytes')
		} finally {
			await oracle.dispose()
			await skewed.dispose()
		}
	})

	it('catches a mutated header and reports component=headers', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(define, (res) => {
			const h = new Headers(res.headers)
			h.set('x-injected', 'skew')
			return new Response(res.body, { status: res.status, headers: h })
		})
		try {
			const m = compareResponses(
				ctx,
				await run(oracle),
				await snapshot(
					await skewed.handle(new Request('http://localhost/x'))
				)
			)
			expect(m?.component).toBe('headers')
			expect(m?.candidate).toContain('x-injected')
		} finally {
			await oracle.dispose()
			await skewed.dispose()
		}
	})

	it('catches a changed status and reports component=status', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(
			define,
			(res) =>
				new Response(res.body, { status: 503, headers: res.headers })
		)
		try {
			const m = compareResponses(
				ctx,
				await run(oracle),
				await snapshot(
					await skewed.handle(new Request('http://localhost/x'))
				)
			)
			expect(m?.component).toBe('status')
			expect(m?.oracle).toBe('200')
			expect(m?.candidate).toBe('503')
		} finally {
			await oracle.dispose()
			await skewed.dispose()
		}
	})

	it('catches reordered set-cookie and reports component=set-cookie', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(define, (res) => {
			const h = new Headers(res.headers)
			const cookies = res.headers.getSetCookie?.() ?? []
			h.delete('set-cookie')
			// Re-append in REVERSED order — set-cookie is order-sensitive.
			for (const c of [...cookies].reverse()) h.append('set-cookie', c)
			return new Response(res.body, { status: res.status, headers: h })
		})
		try {
			const oSnap = await run(oracle)
			const cSnap = await snapshot(
				await skewed.handle(new Request('http://localhost/x'))
			)
			// Sanity: there were multiple cookies to reorder.
			expect(oSnap.setCookie.length).toBeGreaterThan(1)
			const m = compareResponses(ctx, oSnap, cSnap)
			expect(m?.component).toBe('set-cookie')
		} finally {
			await oracle.dispose()
			await skewed.dispose()
		}
	})

	it('date header stripped — a divergent Date does NOT trip the comparator', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(define, (res) => {
			const h = new Headers(res.headers)
			h.set('date', 'Thu, 01 Jan 1970 00:00:00 GMT')
			return new Response(res.body, { status: res.status, headers: h })
		})
		try {
			const m = compareResponses(
				ctx,
				await run(oracle),
				await snapshot(
					await skewed.handle(new Request('http://localhost/x'))
				)
			)
			// date is stripped on both sides — no divergence from it.
			expect(m).toBeNull()
		} finally {
			await oracle.dispose()
			await skewed.dispose()
		}
	})

	it('ignores candidate etag only for the native-static lane pair', async () => {
		const oracle = await snapshot(new Response('same'))
		const candidate = await snapshot(
			new Response('same', { headers: { etag: 'bun-native' } })
		)

		expect(
			compareResponses(
				{ ...ctx, lanePair: 'native-static-off-vs-on@listen' },
				oracle,
				candidate
			)
		).toBeNull()
		expect(compareResponses(ctx, oracle, candidate)?.component).toBe(
			'headers'
		)
	})

	it('catches an observation skew and reports component=observation', () => {
		const oracleObs = ['transform', 'beforeHandle', 'handler']
		const candidateObs = ['transform', 'handler'] // skipped beforeHandle
		const m = compareObservations(ctx, oracleObs, candidateObs)
		expect(m?.component).toBe('observation')
		expect(m?.oracle).toContain('beforeHandle')
	})

	it('identical observations PASS', () => {
		const obs = ['a', 'b', 'c']
		expect(compareObservations(ctx, obs, [...obs])).toBeNull()
	})

	it('observation deepEqual is order-INSENSITIVE for object keys', () => {
		// Two lanes emitting the same facts in a different key order must NOT
		// diverge — this is why we use structural deepEqual, not JSON.stringify.
		const oracle = { a: 1, b: [1, 2], c: { x: true } }
		const candidate = { c: { x: true }, b: [1, 2], a: 1 }
		expect(compareObservations(ctx, oracle, candidate)).toBeNull()
	})

	it('observation deepEqual is order-SENSITIVE for arrays', () => {
		// A hook-fire log's ORDER is the fact — reordering IS a divergence.
		const m = compareObservations(ctx, ['a', 'b'], ['b', 'a'])
		expect(m?.component).toBe('observation')
	})
})
