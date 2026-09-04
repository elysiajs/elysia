import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveHandlerParams } from '../../src/compile/handler/params'

const source = (file: string) =>
	readFileSync(resolve(import.meta.dir, file), 'utf8')

const compilerSource = [
	'../../src/compile/handler/index.ts',
	'../../src/compile/handler/jit.ts',
	'../../src/compile/handler/utils.ts'
]
	.map(source)
	.join('\n')

const paramsSource = source('../../src/compile/handler/params.ts')

const linkedNames = () => {
	const names = new Set<string>()
	for (const m of compilerSource.matchAll(
		/\blink\([^,]+,\s*'([a-z0-9]+)'\)/g
	))
		names.add(m[1]!)
	if (compilerSource.includes("seenKeys.add('ho')")) names.add('ho')
	// `rt`/`fre` are seeded into `seenKeys`/`paramValues` rather than linked
	for (const m of compilerSource.matchAll(
		/\bnew Set<string>\(\[([^\]]+)\]\)/g
	))
		for (const n of m[1]!.matchAll(/'([a-z0-9]+)'/g)) names.add(n[1]!)
	return names
}

const descriptorNames = () =>
	new Set(
		[...paramsSource.matchAll(/^\t([a-z0-9]+): \(/gm)].map(
			(match) => match[1]!
		)
	)

describe('frozen handler parameter descriptors', () => {
	it('matches every dependency linked by the handler compiler', () => {
		const linked = linkedNames()
		expect(linked.size).toBeGreaterThan(20)

		expect([...descriptorNames()].sort()).toEqual(
			[...linked].sort()
		)
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
