import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

const entry = resolve(import.meta.dir, '../../src/index.ts')
const bridge = resolve(import.meta.dir, '../../src/type/bridge.ts')

// Needs a fresh process: in a shared `bun test` process TypeBox is loaded
function run(script: string) {
	const proc = Bun.spawnSync({
		cmd: [process.execPath, '-e', script],
		cwd: resolve(import.meta.dir, '../..'),
		stdout: 'pipe',
		stderr: 'pipe'
	})

	if (proc.exitCode !== 0)
		throw new Error(
			`child exited ${proc.exitCode}\n${proc.stderr.toString()}`
		)

	return JSON.parse(proc.stdout.toString().trim())
}

// listen() loads the TypeBox graph asynchronously before building, which is
// about twice as fast as the synchronous fallback the build uses and keeps it
// out of the first request. Apps that never touch `t` must still not load it.
describe('TypeBox preload on listen', () => {
	it('preloads once an app has used `t`', () => {
		const result = run(`
			const { Elysia, t } = await import(${JSON.stringify(entry)})
			const { preloadTypebox } = await import(${JSON.stringify(bridge)})
			new Elysia().post('/', { body: t.Object({ a: t.String() }) }, ({ body }) => body)
			const pending = preloadTypebox()
			const isPromise = pending instanceof Promise
			await pending
			console.log(JSON.stringify({ isPromise, again: preloadTypebox() === undefined }))
		`)

		// once loaded there is nothing left to preload
		expect(result).toEqual({ isPromise: true, again: true })
	})

	it('does not load TypeBox for an app without `t`', () => {
		const result = run(`
			const { Elysia } = await import(${JSON.stringify(entry)})
			const { preloadTypebox } = await import(${JSON.stringify(bridge)})
			new Elysia().get('/', () => 'ok')
			console.log(JSON.stringify({ preload: preloadTypebox() === undefined }))
		`)

		expect(result).toEqual({ preload: true })
	})

	it('serves the first request after listen with TypeBox preloaded', () => {
		const result = run(`
			const { Elysia, t } = await import(${JSON.stringify(entry)})
			const app = new Elysia()
				.post('/', { body: t.Object({ a: t.String() }) }, ({ body }) => body.a)
				.listen(0)
			const res = await fetch(app.server.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ a: 'ok' })
			})
			const body = await res.text()
			await app.stop(true)
			console.log(JSON.stringify({ status: res.status, body }))
		`)

		expect(result).toEqual({ status: 200, body: 'ok' })
	})
})
