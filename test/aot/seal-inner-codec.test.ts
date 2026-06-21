import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'

/**
 * Tier 2 — ObjectString / ArrayString reconstruct typebox-free under seal. A
 * sealed app must produce byte-identical responses to a plain (JIT) app across
 * inner codecs (Numeric/Date), inner defaults, nesting and arrays. We compile to
 * the real manifest source, eval it, run with `globalThis.ELY_SEALED` set,
 * and compare to the same app run plainly.
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

const sealVsPlain = async (
	make: () => any,
	reqs: Array<[string, RequestInit?]>
) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	const src = await compileToSource(make() as any, {
		register: false,
		seal: true
	})
	delete process.env.ELYSIA_AOT_BUILD

	const run = async () => {
		const app = make()
		;(app as any).compile()
		const out: unknown[] = []
		for (const [url, init] of reqs)
			out.push(
				await app
					.handle(new Request('http://localhost' + url, init))
					.then((r) =>
						r.status === 200 ? r.json() : 'HTTP ' + r.status
					)
			)
		return out
	}

	Compiled.clear()
	Validator.clear()
	Compiled.validators = evalManifest(src)
	G.ELY_SEALED = true
	const sealed = await run()

	G.ELY_SEALED = undefined
	Compiled.clear()
	Validator.clear()
	const plain = await run()

	return { sealed, plain }
}

const q = (o: unknown) => '?f=' + encodeURIComponent(JSON.stringify(o))
const json = (o: unknown): RequestInit => ({
	method: 'POST',
	body: JSON.stringify(o),
	headers: { 'content-type': 'application/json' }
})

describe('seal inner codec — sealed ≡ plain round-trip', () => {
	const cases: Array<{
		name: string
		make: () => any
		reqs: Array<[string, RequestInit?]>
	}> = [
		{
			name: 'nested Numeric inner (coerces)',
			make: (): any =>
				new Elysia().get(
					'/x',
					{
						query: t.Object({
							f: t.Object({ age: t.Numeric(), name: t.String() })
						})
					},
					({ query }) => query
				),
			reqs: [['/x' + q({ age: '5', name: 'sa' })]]
		},
		{
			name: 'inner Date codec',
			make: (): any =>
				new Elysia().get(
					'/x',
					{ query: t.Object({ f: t.Object({ d: t.Date() }) }) },
					({ query }) => query
				),
			reqs: [['/x' + q({ d: '2021-05-05' })]]
		},
		{
			name: 'deep nested ObjectString',
			make: (): any =>
				new Elysia().get(
					'/x',
					{
						query: t.Object({
							f: t.Object({ g: t.Object({ n: t.Numeric() }) })
						})
					},
					({ query }) => query
				),
			reqs: [['/x' + q({ g: { n: '5' } })]]
		},
		{
			name: 'ArrayString of objects with Numeric',
			make: (): any =>
				new Elysia().get(
					'/y',
					{ query: t.Object({ tags: t.Array(t.Object({ id: t.Numeric() })) }) },
					({ query }) => query
				),
			reqs: [['/y?tags=' + encodeURIComponent('[{"id":"1"},{"id":"2"}]')]]
		},
		{
			name: 'explicit ObjectString body',
			make: (): any =>
				new Elysia().post(
					'/b',
					{ body: t.ObjectString({ age: t.Numeric(), tags: t.Array(t.String()) }) },
					({ body }) => body
				),
			reqs: [['/b', json('{"age":"5","tags":["a","b"]}')]]
		},
		{
			name: 'invalid inner rejected identically',
			make: (): any =>
				new Elysia().get(
					'/x',
					{ query: t.Object({ f: t.Object({ age: t.Numeric() }) }) },
					({ query }) => query
				),
			reqs: [['/x' + q({ age: 'notnum' })]]
		},
	]

	for (const { name, make, reqs } of cases)
		it(name, async () => {
			const { sealed, plain } = await sealVsPlain(make, reqs)
			expect(sealed).toEqual(plain)
		})
})

describe('seal inner codec — inner defaults refuse to seal', () => {
	// ObjectString/ArrayString inner defaults aren't reconstructed under seal
	// (dropped 2026-06-21): the slot refuses to freeze, so seal:'strict' fails
	// and best-effort degrades (keeps TypeBox, which fills the default at runtime).
	const innerDefaultApp = () =>
		new Elysia().get(
			'/x',
			{
				query: t.Object({
					f: t.Object({
						role: t.String({ default: 'user' }),
						name: t.String()
					})
				})
			},
			({ query }) => query
		)

	it("seal:'strict' refuses a route with an inner default", async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		await expect(
			compileToSource(innerDefaultApp() as any, {
				register: false,
				seal: 'strict'
			})
		).rejects.toThrow(/Cannot seal/)
		delete process.env.ELYSIA_AOT_BUILD
	})
})
