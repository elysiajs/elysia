import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	HANDLER_PARAMS,
	resolveHandlerParams
} from '../../src/compile/handler/params'

/** Every captured handler dependency needs one runtime parameter descriptor. */

const SRC = [
	'../../src/compile/handler/index.ts',
	'../../src/compile/handler/jit.ts',
	'../../src/compile/handler/utils.ts'
]
	.map((file) => readFileSync(resolve(import.meta.dir, file), 'utf8'))
	.join('\n')

const linkedNames = () => {
	const names = new Set<string>()
	for (const m of SRC.matchAll(/\blink\([^,]+,\s*'([a-z0-9]+)'\)/g))
		names.add(m[1]!)
	if (SRC.includes("seenKeys.add('ho')")) names.add('ho')
	return names
}

describe('frozen handler parameter descriptors', () => {
	it('matches every dependency linked by the handler compiler', () => {
		const linked = linkedNames()
		expect(linked.size).toBeGreaterThan(20)

		const missing = [...linked].filter((n) => !(n in HANDLER_PARAMS))
		const stale = Object.keys(HANDLER_PARAMS).filter((n) => !linked.has(n))

		expect(missing).toEqual([])
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
		expect(
			resolveHandlerParams(['rc'], { res: { map: 'M' } } as any)
		).toEqual(['M'])
	})

	it('rejects an unknown dependency name', () => {
		expect(() => resolveHandlerParams(['bogus'], {} as any)).toThrow(
			/Fail to reconstruct build/
		)
	})
})
