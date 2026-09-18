import { describe, expect, it } from 'bun:test'
import { heapStats } from 'bun:jsc'

import { Elysia } from '../../src'

describe('Elysia instance footprint', () => {
	it('uses each app as its inherited program identity', () => {
		const app = new Elysia()
		const other = new Elysia()

		expect(app['~programId']).toBe(app as any)
		expect(app['~programId']).not.toBe(other['~programId'])
		expect('~programId' in app).toBe(true)
		expect(Object.hasOwn(app, '~programId')).toBe(false)
		expect(Object.getOwnPropertyNames(app)).toEqual([
			'~Prefix',
			'hasPlugin',
			'hasGlobal',
			'ready',
			'_pending',
			'_error',
			'hash',
			'childrenHash',
			'scopeParent',
			'pluginMacros',
			'macroBaseline',
			'macroSnapshots',
			'declaredRoutes',
			'routeSources',
			'compiled',
			'jitColdRemaining',
			'jitTable',
			'jitRoute',
			'jitStatic',
			'jitAliases',
			'routerBuilt',
			'fetchFn',
			'_handle',
			'~config',
			'~ext',
			'~hookChain',
			'~wsConfig',
			'server',
			'~router',
			'~map',
			'~routeTable',
			'~hasWS',
			'~hasDynamicWS',
			'~hasTrace',
			'~finalizeError',
			'~aotFingerprint',
			'~compilerSession',
			'~generation',
			'~introspect',
			'~scopeChild',
			'~scopeChildren'
		])

		expect(JSON.stringify(app)).toBe('{"_pending":0,"routerBuilt":false}')
	})

	it('bare instance stays under the JSC butterfly cliff', () => {
		// warm allocation profile + shared structures
		for (let i = 0; i < 100; i++) new Elysia()

		const N = 10_000
		const sink = new Array(N)

		Bun.gc(true)
		const before = heapStats().heapSize
		for (let i = 0; i < N; i++) sink[i] = new Elysia()
		Bun.gc(true)
		const perInstance = (heapStats().heapSize - before) / N

		// baseline ~386 B; a separate program-id object lands at ~450 B,
		// the next butterfly step at ~482 B (+96)
		expect(perInstance).toBeLessThan(430)

		// keep the sink alive past the measurement
		expect(sink.length).toBe(N)
	})
})
