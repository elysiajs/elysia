import { describe, expect, it, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'ely-wired-cookie-error-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// #2024: a wired build statically links `error -> type/bridge-live ->
// validator -> ... -> cookie/*`. The consumer entry (`elysia` -> dist/index)
// enters `error` first, so any `extends ElysiaError` living in a cookie module
// is evaluated before `ElysiaError` exists and the bundle throws at startup
describe('wired AOT bundle with the cookie jar kept', () => {
	it.each([
		[
			'union-literal response',
			'wired-union-literal-response-app.ts',
			'{"status":"ok"}'
		],
		['cookie route + union body', 'wired-cookie-app.ts', 'none']
	])('%s evaluates and serves', async (_, fixture, body) => {
		const app = resolve(import.meta.dir, 'fixtures', fixture)
		// dist plugin + `elysia` imports: the consumer graph, not src
		const { aot } = await import('elysia/plugin/aot/bun')

		const result = await Bun.build({
			entrypoints: [app],
			target: 'bun',
			plugins: [aot(app, { target: 'bun' })]
		})
		if (!result.success) throw new AggregateError(result.logs)

		const text = await result.outputs[0]!.text()
		// preconditions: wired bridge and real (unstubbed) cookie modules
		expect(text).toContain('unionPrioritySort')
		expect(text).toContain('invalid-cookie')

		// own directory: Bun caches a directory listing once it imported from it
		const out = join(mkdtempSync(join(dir, 'case-')), 'app.mjs')
		writeFileSync(out, text)

		const mod = await import(out)
		const response = await mod.app.handle(new Request('http://localhost/'))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(body)
	})
})
