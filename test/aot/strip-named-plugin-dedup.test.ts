import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { aot as bunAot } from '../../src/plugin/aot/bun'

const APP = resolve(import.meta.dir, 'fixtures/strip-named-plugin-dedup-app.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const ROUTE_SHAPE_FROM = resolve(
	import.meta.dir,
	'../../src/compile/handler/route-shape.ts'
)

// The composed hooks a stripped bundle replays are the ones the live app
// builds: a named plugin seen below and then used directly keeps its gate
describe('stripped AOT bundle of a plugin installed below, then directly', () => {
	it('replays the gate, the derive and the plugin order', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					routeShapeFrom: ROUTE_SHAPE_FROM,
					strip: 'auto'
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)

		const text = await result.outputs[0].text()
		expect(text).toContain('handler compiler JIT was stripped')

		const tmp = resolve(
			import.meta.dir,
			`_built.strip-dedup.${Date.now()}.mjs`
		)
		await Bun.write(tmp, text)

		try {
			const mod: any = await import(tmp)
			const get = async (path: string, authorization?: string) => {
				mod.calls.length = 0
				const response = await mod.app.handle(
					new Request(`http://localhost${path}`, {
						headers: authorization ? { authorization } : {}
					})
				)
				return [
					response.status,
					await response.text(),
					mod.calls.slice()
				]
			}

			expect(await get('/admin')).toEqual([
				401,
				'no',
				['global:undefined', 'gate']
			])
			expect(await get('/admin', 'alice')).toEqual([
				200,
				'user=alice',
				['global:alice', 'gate']
			])
			expect(await get('/feature')).toEqual([
				401,
				'no',
				['global:undefined', 'gate']
			])
		} finally {
			await rm(tmp, { force: true })
		}
	})
})
