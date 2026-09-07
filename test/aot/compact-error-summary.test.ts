import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'

/** Many coerced-query routes must collapse into a bounded number of warn lines. */

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	delete process.env.ELYSIA_AOT_VERBOSE
	Compiled.clear()
	Validator.clear()
})

function captureRouteCount(count: number, verbose = false): string[] {
	process.env.ELYSIA_AOT_BUILD = '1'
	if (verbose) process.env.ELYSIA_AOT_VERBOSE = '1'

	const warns: string[] = []
	const original = console.warn
	console.warn = (...args: unknown[]) => warns.push(args.join(' '))

	try {
		beginValidatorCapture()

		let app = new Elysia()
		for (let i = 0; i < count; i++)
			app = app.get(
				`/r${i}`,
				{ query: t.Object({ n: t.Numeric() }) },
				({ query }) => query
			)

		;(app as any).compile()
		endValidatorCapture()
		endHandlerCapture()
	} finally {
		console.warn = original
		delete process.env.ELYSIA_AOT_BUILD
		delete process.env.ELYSIA_AOT_VERBOSE
	}

	return warns.filter((w) => w.includes('[elysia-aot]'))
}

describe('compact-error warning aggregation', () => {
	it('collapses any number of coerced-query routes into a single summary line by default', () => {
		const warns = captureRouteCount(8)

		expect(warns.length).toBe(1)
		expect(warns[0]).toContain('8 sealed validator slots')
		expect(warns[0]).toContain('ELYSIA_AOT_VERBOSE=1')
	})

	it('prints no warning at all when no route is affected', () => {
		const warns = captureRouteCount(0)

		expect(warns.length).toBe(0)
	})

	it('prints a singular summary line for exactly one affected route', () => {
		const warns = captureRouteCount(1)

		expect(warns.length).toBe(1)
		expect(warns[0]).toContain('1 sealed validator slot ')
		expect(warns[0]).toContain('carries')
	})

	it('prints one detail line per route when ELYSIA_AOT_VERBOSE is set, and no summary', () => {
		const warns = captureRouteCount(8, true)

		expect(warns.length).toBe(8)
		expect(warns.every((w) => w.includes('best-effort'))).toBe(true)
	})
})
