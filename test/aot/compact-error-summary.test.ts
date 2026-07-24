import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	resetCompactErrorWarnings
} from '../../src/compile/aot-capture'

/** Many coerced-query routes must collapse into a bounded number of warn lines. */

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

function captureRouteCount(count: number): string[] {
	process.env.ELYSIA_AOT_BUILD = '1'
	resetCompactErrorWarnings()

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
	}

	return warns.filter((w) => w.includes('[elysia-aot]'))
}

describe('compact-error warning aggregation', () => {
	it('collapses 8 coerced-query routes into 5 details + 1 summary', () => {
		const warns = captureRouteCount(8)

		expect(warns.length).toBe(6)
		expect(warns.slice(0, 5).every((w) => w.includes('best-effort'))).toBe(
			true
		)
		expect(warns[5]).toContain('3 more')
	})

	it('prints only detail lines when under the limit (3 routes)', () => {
		const warns = captureRouteCount(3)

		expect(warns.length).toBe(3)
		expect(warns.every((w) => w.includes('best-effort'))).toBe(true)
	})
})
