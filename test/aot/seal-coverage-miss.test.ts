import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'

/**
 * Seal is closed-world: every validated route must be captured into the AOT
 * manifest. A validated route OUTSIDE the captured graph — a mounted Elysia
 * sub-app, a deferred plugin, a `registerFrom` mismatch — gets no frozen entry
 * and has no JIT fallback under seal. Rather than crashing with a cryptic
 * `this.tb.Check undefined`, it must FAIL LOUD with an actionable message naming
 * the route + the closed-world cause (validator.ts construction guard). Mounts
 * of non-Elysia / non-validated handlers stay fine.
 */

const G = globalThis as any

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	G.ELY_SEALED = undefined
	delete process.env.ELYSIA_AOT_BUILD
})

const evalManifest = (src: string): any =>
	new Function(
		src
			.replace('export const validators', 'const validators')
			.replace('export const handlers', 'const handlers')
			.replace('export default validators', 'return validators')
			.replace(/^import .*$/gm, '')
	)()

const make = () => {
	const validated = new Elysia().post(
		'/inner',
		{ body: t.Object({ z: t.Boolean() }) },
		({ body }: any) => body
	)
	const plain = (_req: Request) =>
		new Response(JSON.stringify({ ok: true }), {
			headers: { 'content-type': 'application/json' }
		})

	return new Elysia()
		.post('/own', { body: t.Object({ a: t.String() }) }, ({ body }: any) => body)
		.mount('/m', validated.handle)
		.mount('/safe', plain)
}

const sealedHit = async () => {
	process.env.ELYSIA_AOT_BUILD = '1'
	const src = await compileToSource(make() as any, {
		register: false,
		seal: true
	})
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	Compiled.validators = evalManifest(src)
	G.ELY_SEALED = true

	const app: any = make()
	app.compile()
	return async (url: string) => {
		const r = await app.handle(
			new Request('http://localhost' + url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ z: true })
			})
		)
		return { status: r.status, body: await r.text() }
	}
}

describe('seal — closed-world coverage miss fails loud', () => {
	it('a validated route in a mounted sub-app fails loud with an actionable message', async () => {
		const hit = await sealedHit()
		const res = await hit('/m/inner')

		expect(res.status).toBe(500)
		// actionable: names the route + the closed-world cause
		expect(res.body).toContain('sealed build is missing a frozen validator')
		expect(res.body).toContain('POST /inner')
		expect(res.body).toContain('mounted')
		// NOT the cryptic pre-fix crash: `this.tb` is undefined → at runtime V8/JSC
		// reports the evaluated expression (`undefined is not an object …`), never
		// the source token `this.tb`, so assert the real crash signature is absent.
		expect(res.body).not.toContain('is not an object')
	})

	it('mounting a non-Elysia / non-validated handler stays safe under seal', async () => {
		const hit = await sealedHit()
		const res = await hit('/safe/inner')

		expect(res.status).toBe(200)
		expect(res.body).toContain('ok')
	})
})
