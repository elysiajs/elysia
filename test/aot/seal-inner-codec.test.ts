import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'

/**
 * Tier 2 — ObjectString / ArrayString reconstruct typebox-free under seal. A
 * sealed app must produce byte-identical responses to a plain (JIT) app across
 * inner codecs (Numeric/Date), inner defaults, nesting and arrays. We compile to
 * the real manifest source, eval it, run with `globalThis.__ELYSIA_SEALED__` set,
 * and compare to the same app run plainly.
 */

const G = globalThis as any

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	G.__ELYSIA_SEALED__ = undefined
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
	G.__ELYSIA_SEALED__ = true
	const sealed = await run()

	G.__ELYSIA_SEALED__ = undefined
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
			name: 'inner default applied on omitted key',
			make: (): any =>
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
				),
			reqs: [['/x' + q({ name: 'sa' })], ['/x' + q({ name: 'sa', role: 'admin' })]]
		},
		{
			name: 'Numeric inner + default together',
			make: (): any =>
				new Elysia().get(
					'/x',
					{
						query: t.Object({
							f: t.Object({
								age: t.Numeric(),
								role: t.String({ default: 'user' })
							})
						})
					},
					({ query }) => query
				),
			reqs: [['/x' + q({ age: '7' })]]
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
		{
			// STRING-branch inner default (body field sent as a JSON string): the
			// bare refine Check applies NO default, so an omitted defaulted key must
			// be REJECTED identically to plain (regression: a sealed app once
			// fabricated a 200 here where plain returns 422).
			name: 'string-branch inner-default rejects identically',
			make: (): any =>
				new Elysia().post(
					'/b',
					{
						body: t.Object({
							cfg: t.ObjectString({
								a: t.String(),
								d: t.String({ default: 'D' })
							})
						})
					},
					({ body }) => body
				),
			reqs: [
				['/b', json({ cfg: '{"a":"A"}' })],
				['/b', json({ cfg: '{"a":"A","d":"X"}' })]
			]
		},
		{
			name: 'headers string-branch inner-default rejects identically',
			make: (): any =>
				new Elysia().get(
					'/h',
					{
						headers: t.Object({
							meta: t.Object({
								role: t.String({ default: 'user' }),
								name: t.String()
							})
						})
					},
					({ headers }) => headers
				),
			reqs: [
				['/h', { headers: { meta: '{"name":"x"}' } }],
				['/h', { headers: { meta: '{"name":"x","role":"admin"}' } }]
			]
		}
	]

	for (const { name, make, reqs } of cases)
		it(name, async () => {
			const { sealed, plain } = await sealVsPlain(make, reqs)
			expect(sealed).toEqual(plain)
		})
})
