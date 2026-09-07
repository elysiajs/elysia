// Each test changes one response component and verifies the reported mismatch.

import { describe, it, expect } from 'bun:test'
import { jitHandle, type Lane, type Define } from './lanes'
import {
	snapshot,
	compareResponses,
	compareObservations,
	type ResponseSnapshot
} from './compare'

const ctx = { corpusId: 'self', requestId: 'probe', lanePair: 'self' }

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

describe('differential comparator detects injected skew', () => {
	it('returns no mismatch for identical lanes', async () => {
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

	it('reports a body mismatch when one byte changes', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(define, (res) => {
			return res.text().then(
				(t) =>
					new Response('X' + t.slice(1), {
						status: res.status,
						headers: res.headers
					})
			) as any
		})
		try {
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

	it('reports a header mismatch when one header changes', async () => {
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

	it('reports a status mismatch when the status changes', async () => {
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

	it('reports a cookie mismatch when cookie order changes', async () => {
		const oracle = await jitHandle.make(define)
		const skewed = await skewedLane(define, (res) => {
			const h = new Headers(res.headers)
			const cookies = res.headers.getSetCookie?.() ?? []
			h.delete('set-cookie')
			for (const c of [...cookies].reverse()) h.append('set-cookie', c)
			return new Response(res.body, { status: res.status, headers: h })
		})
		try {
			const oSnap = await run(oracle)
			const cSnap = await snapshot(
				await skewed.handle(new Request('http://localhost/x'))
			)
			expect(oSnap.setCookie.length).toBeGreaterThan(1)
			const m = compareResponses(ctx, oSnap, cSnap)
			expect(m?.component).toBe('set-cookie')
		} finally {
			await oracle.dispose()
			await skewed.dispose()
		}
	})

	it('ignores Date header differences', async () => {
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

	it('reports a lifecycle observation mismatch', () => {
		const oracleObs = ['transform', 'beforeHandle', 'handler']
		const candidateObs = ['transform', 'handler'] // skipped beforeHandle
		const m = compareObservations(ctx, oracleObs, candidateObs)
		expect(m?.component).toBe('observation')
		expect(m?.oracle).toContain('beforeHandle')
	})

	it('returns no mismatch for identical observations', () => {
		const obs = ['a', 'b', 'c']
		expect(compareObservations(ctx, obs, [...obs])).toBeNull()
	})

	it('treats object key order as insignificant', () => {
		const oracle = { a: 1, b: [1, 2], c: { x: true } }
		const candidate = { c: { x: true }, b: [1, 2], a: 1 }
		expect(compareObservations(ctx, oracle, candidate)).toBeNull()
	})

	it('treats array order as significant', () => {
		const m = compareObservations(ctx, ['a', 'b'], ['b', 'a'])
		expect(m?.component).toBe('observation')
	})
})
