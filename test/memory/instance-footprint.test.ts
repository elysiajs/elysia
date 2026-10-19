import { describe, expect, it } from 'bun:test'
import { heapStats } from 'bun:jsc'
import { resolve } from 'node:path'

import { Elysia } from '../../src'

const dist = resolve(import.meta.dir, '../../dist/index.mjs')

let distLayout:
	| { names: string[]; json: string; perInstance: number }
	| undefined

// The build drops uninitialized fields (tsconfig target ES2021) where Bun
// keeps them for src, so what users run has its own, smaller layout
const measureDist = () => {
	if (distLayout) return distLayout

	const proc = Bun.spawnSync({
		cmd: [
			process.execPath,
			'-e',
			`const { heapStats } = require('bun:jsc')\n` +
				`const { Elysia } = await import(${JSON.stringify(dist)})\n` +
				`const app = new Elysia()\n` +
				`for (let i = 0; i < 100; i++) new Elysia()\n` +
				`const N = 10_000\n` +
				`const sink = new Array(N)\n` +
				`Bun.gc(true)\n` +
				`const before = heapStats().heapSize\n` +
				`for (let i = 0; i < N; i++) sink[i] = new Elysia()\n` +
				`Bun.gc(true)\n` +
				`const perInstance = (heapStats().heapSize - before) / sink.length\n` +
				`console.log(JSON.stringify({ names: Object.getOwnPropertyNames(app), json: JSON.stringify(app), perInstance }))`
		],
		cwd: resolve(import.meta.dir, '../..'),
		stdout: 'pipe',
		stderr: 'pipe'
	})

	if (proc.exitCode !== 0)
		throw new Error(
			`child exited ${proc.exitCode}\n${proc.stderr.toString()}`
		)

	return (distLayout = JSON.parse(proc.stdout.toString()))
}

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
			'ready',
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
			'jitAliases',
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
			'~scopeChild',
			'~scopeChildren'
		])

		expect(JSON.stringify(app)).toBe('{}')
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

	it('keeps the built instance layout', () => {
		const { names, json } = measureDist()

		expect(names).toEqual([
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
			'~scopeChild',
			'~scopeChildren',
			'~Prefix'
		])

		expect(json).toBe('{}')
	})

	it('bare built instance stays under the JSC butterfly cliff', () => {
		// baseline ~224 B: 21 of 26 inline slots, no butterfly. The first
		// out-of-line property lands at ~256 B, every #field counts
		expect(measureDist().perInstance).toBeLessThan(240)
	})
})
