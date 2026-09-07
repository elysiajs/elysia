import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

const entry = resolve(import.meta.dir, '../../src/index.ts')

function run(script: string) {
	const proc = Bun.spawnSync({
		cmd: [process.execPath, '-e', script],
		cwd: resolve(import.meta.dir, '../..'),
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const stdout = proc.stdout.toString().trim()

	if (proc.exitCode !== 0)
		throw new Error(
			`child exited ${proc.exitCode}\n${proc.stderr.toString()}`
		)

	return stdout
}

// The whole graph minus TypeBox. Both tests below share it: constructing the
// modal schema must not move the number at all
const CEILING = 1_000_000

/**
 * TypeBox must stay OUT of the eager import graph — it loads on first use via
 * `src/type/typebox-value.ts` and `typebox-type.ts` (serverless cold-start
 * heap). One static `import { X } from 'typebox/...'` anywhere in the eager
 * graph silently undoes the whole deferral — hence the pinned ceiling.
 * Measured: 2,549,614 B both eager · 1,804,643 B value deferred · 793,907 B both.
 */
describe('eager import graph', () => {
	it('keeps TypeBox out of the import graph', () => {
		const heapDelta = Number(
			run(
				`const { heapStats } = require('bun:jsc')\n` +
					`Bun.gc(true)\n` +
					`const before = heapStats().heapSize\n` +
					`await import(${JSON.stringify(entry)})\n` +
					`Bun.gc(true)\n` +
					`console.log(heapStats().heapSize - before)`
			)
		)

		expect(heapDelta).toBeGreaterThan(0)
		expect(heapDelta).toBeLessThan(CEILING)
	})

	/**
	 * The modal Elysia schema is built entirely from Elysia-owned builders, so
	 * declaring routes must not load TypeBox either — the deferral is only worth
	 * anything if it survives schema CONSTRUCTION, not just import. `t.String()`
	 * and friends returning a hand-built singleton instead of calling
	 * `typebox/type` is what buys that, and it is easy to undo by accident.
	 */
	it('builds the modal schema without loading TypeBox', () => {
		const heapDelta = Number(
			run(
				`const { heapStats } = require('bun:jsc')\n` +
					`Bun.gc(true)\n` +
					`const before = heapStats().heapSize\n` +
					`const { t } = await import(${JSON.stringify(entry)})\n` +
					`t.Object({ name: t.String() })\n` +
					`t.Number()\n` +
					`t.Boolean()\n` +
					`t.Integer()\n` +
					`Bun.gc(true)\n` +
					`console.log(heapStats().heapSize - before)`
			)
		)

		expect(heapDelta).toBeGreaterThan(0)
		expect(heapDelta).toBeLessThan(CEILING)
	})

	// The deferral is only sound if the lazy load actually resolves in a plain
	// process: a schema'd route must validate exactly as before, with TypeBox
	// pulled in on demand rather than at import
	it('still validates after loading TypeBox on demand', async () => {
		const out = run(
			`const { Elysia, t } = await import(${JSON.stringify(entry)})\n` +
				`const app = new Elysia().post('/', { body: t.Object({ name: t.String() }) }, ({ body }) => body)\n` +
				`const request = (name) => new Request('http://localhost/', {\n` +
				`	method: 'POST',\n` +
				`	headers: { 'content-type': 'application/json' },\n` +
				`	body: JSON.stringify({ name })\n` +
				`})\n` +
				`const ok = await app.handle(request('elysia'))\n` +
				`const invalid = await app.handle(request(1))\n` +
				`console.log(JSON.stringify({ ok: ok.status, body: await ok.json(), invalid: invalid.status }))`
		)

		expect(JSON.parse(out)).toEqual({
			ok: 200,
			body: { name: 'elysia' },
			invalid: 422
		})
	})
})
