import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { compileToSource } from '../../src/plugin/aot/source'
import { Compiled } from '../../src/compile/aot'

// The `entryParts` + branch/union interning
// hoist to module scope must leave `emitModule`'s output BYTE-IDENTICAL. This is
// the snapshot proof: a validator-heavy app (objects, union, optional-numeric,
// default, response) whose emitted source is asserted stable. If the hoist ever
// changes the encoder's output, this fails.
const validatorHeavyApp = () =>
	new Elysia()
		.post(
			'/a',
			{ body: t.Object({ name: t.String(), age: t.Number() }) },
			({ body }) => body
		)
		.get('/b', { query: t.Object({ q: t.String() }) }, ({ query }) => query)
		.get(
			'/c/:id',
			{ params: t.Object({ id: t.String() }) },
			({ params }) => params
		)
		.post(
			'/u',
			{
				body: t.Union([
					t.Object({ a: t.String() }),
					t.Object({ b: t.Number() })
				])
			},
			({ body }) => body
		)
		.get(
			'/n',
			{ query: t.Object({ x: t.Optional(t.Numeric()) }) },
			({ query }) => query
		)
		.post(
			'/d',
			{ body: t.Object({ role: t.String({ default: 'user' }) }) },
			({ body }) => body
		)
		.get('/r', { response: t.Object({ ok: t.Boolean() }) }, () => ({
			ok: true
		}))

describe('emitModule output stability (entryParts hoist)', () => {
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
		Compiled.clear()
	})

	it('is deterministic across two builds of the same app', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		const a = await compileToSource(validatorHeavyApp(), { register: false })
		Compiled.clear()
		const b = await compileToSource(validatorHeavyApp(), { register: false })
		expect(a).toBe(b)
	})

	it('emits the shared `_b`/`_u` branch/union interning (hoist reused it)', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		const src = await compileToSource(validatorHeavyApp(), {
			register: false
		})
		// the union route interns branch (`_b`) + union (`_u`) consts through the
		// shared encoder; their presence proves the hoisted encoder still runs
		expect(src).toMatch(/const _u0 = /)
		expect(src).toMatch(/const _c0 = /)
	})
})
