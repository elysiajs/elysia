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
		const finalizeError = () => new Response()
		const ctx = {
			finalizeError,
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
		expect(resolveHandlerParams(['ff'], ctx)).toEqual([finalizeError])
		expect(
			resolveHandlerParams(['rc'], { res: { map: 'M' } } as any)
		).toEqual(['M'])
	})

	it('rejects an unknown dependency name', () => {
		expect(() => resolveHandlerParams(['bogus'], {} as any)).toThrow(
			/Fail to reconstruct build/
		)
	})

	it('lowers compact beforeHandle state to executable callbacks only', () => {
		const callbacks = Array.from({ length: 65 }, (_, i) => () => i)
		let tail: any
		for (let i = 0; i < callbacks.length; i += 16)
			tail = { parent: tail, values: callbacks.slice(i, i + 16) }

		const [runtime] = resolveHandlerParams(['bp'], {
			hook: {
				'~beforeHandlePrefix': {
					tail,
					length: callbacks.length,
					previous: { authoring: true },
					added: callbacks.slice(-1),
					inference: { body: true }
				}
			}
		} as any)

		expect(Array.isArray(runtime)).toBe(true)
		expect(runtime).toEqual(callbacks)
		expect(runtime).not.toHaveProperty('previous')
		expect(runtime).not.toHaveProperty('inference')
	})
})
