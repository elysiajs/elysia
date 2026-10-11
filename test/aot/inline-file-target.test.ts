import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, file } from '../../src'
import {
	captureArtifacts,
	replayStubbability
} from '../../src/plugin/aot/source'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

// Only Bun maps an inline file() to a reusable static Response. A capture for
// any other target must leave it a runtime value, or replay there drifts and,
// with the JIT stripped, the route 500s
describe('inline file() AOT target', () => {
	for (const [target, baked] of [
		['bun', true],
		['node', false],
		['workerd', false]
	] as const)
		it(`captures and replays for AOT target '${target}'`, async () => {
			const app = new Elysia().get('/', file('test/images/aris-yuzu.jpg'))
			const { handlers } = await captureArtifacts(app, { target })
			expect(handlers[0]!.code.includes('cr(h)')).toBe(baked)

			// a drifted replay keeps the JIT, so strip can't drop it
			expect(replayStubbability(app, handlers, target).reasons).toEqual(
				[]
			)
		})
})
