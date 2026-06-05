import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	HANDLER_PARAMS,
	resolveHandlerParams
} from '../../src/compile/handler/params'

/**
 * AOT handler-freeze — ParamDescriptor coverage.
 *
 * The full handler freeze (which subsumes sucrose) rebuilds `params` at runtime
 * from the captured `alias` via `HANDLER_PARAMS`. If a `link(value, name)` site
 * in `compileHandler` has no descriptor, a frozen handler would bind the wrong
 * deps — and on Cloudflare there's no `new Function` fallback to save it. So this
 * test pins the dictionary to the EXACT `link` vocabulary: a new `link` name fails
 * here until a descriptor is added; a removed one fails as stale.
 */

const SRC = readFileSync(
	resolve(import.meta.dir, '../../src/compile/handler/index.ts'),
	'utf8'
)

const linkedNames = () => {
	const names = new Set<string>()
	// link(value, 'name')
	for (const m of SRC.matchAll(/\blink\([^,]+,\s*'([a-z0-9]+)'\)/g))
		names.add(m[1]!)
	// the `link(0, '')` sentinel adds the composed hook as `ho`
	if (SRC.includes('params.add(hook)')) names.add('ho')
	return names
}

describe('AOT handler ParamDescriptor', () => {
	it('exactly covers every compileHandler link() name', () => {
		const linked = linkedNames()
		expect(linked.size).toBeGreaterThan(20) // sanity: regex actually matched

		const missing = [...linked].filter((n) => !(n in HANDLER_PARAMS))
		const stale = Object.keys(HANDLER_PARAMS).filter((n) => !linked.has(n))

		// a link site with no descriptor → CF would silently bind the wrong dep
		expect(missing).toEqual([])
		// a descriptor for a name no longer linked → dead weight
		expect(stale).toEqual([])
	})

	it('resolves params positionally, in alias order', () => {
		const ctx = {
			parse: { json: 'PJ', formData: 'PF' },
			res: { map: 'RM', compact: 'RC' },
			hook: { beforeHandle: 'BF', afterHandle: 'AF', error: 'ER' },
			vali: 'VA',
			cookieConfig: 'CC',
			tracers: 'TR'
		} as any

		expect(
			resolveHandlerParams(['pj', 'va', 'bf', 'rc', 'cc', 'tr'], ctx)
		).toEqual(['PJ', 'VA', 'BF', 'RC', 'CC', 'TR'])
		expect(resolveHandlerParams([], ctx)).toEqual([])
		// `rc` falls back to res.map when compact is absent
		expect(
			resolveHandlerParams(['rc'], { res: { map: 'M' } } as any)
		).toEqual(['M'])
	})

	it('throws loudly on an unknown link name (no silent mis-bind)', () => {
		expect(() => resolveHandlerParams(['bogus'], {} as any)).toThrow(
			/Fail to reconstruct build/
		)
	})
})
