import { afterEach, describe, expect, it } from 'bun:test'
import * as value from 'typebox/value'
import * as schema from 'typebox/schema'
import * as compile from 'typebox/compile'

import { fileTypeFromBlob } from 'file-type'
import z from 'zod'

import { Elysia, setFileTypeDetector, t } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { injectTypebox } from '../../src/type/typebox-value'
import { useTypebox } from '../../src/type/bridge'
import * as live from '../../src/type/bridge-live'

/**
 * #2001: TypeBox 1.3.24 removed `buildResult` from the `typebox/schema`
 * Validator (sinclairzx81/typebox#1680). Every eager compile read
 * `tb.buildResult.external` unconditionally, so `.compile()` / `precompile`
 * threw for any route with a schema on a TypeBox inside our peer range.
 *
 * The lockfile pins an older TypeBox, so simulate the newer Validator shape
 */
const withoutBuildResult = () =>
	injectTypebox({
		value,
		compile,
		schema: {
			Build: schema.Build,
			Compile: ((s: any) => {
				const v: any = schema.Compile(s)
				delete v.buildResult

				return v
			}) as typeof schema.Compile
		}
	})

afterEach(() => injectTypebox({ value, schema, compile }))

const app = (config?: { precompile: true }) =>
	new Elysia(config)
		.get(
			'/n/:id',
			{ params: t.Object({ id: t.Numeric() }) },
			({ params }) => params
		)
		.get('/q', { query: t.Object({ n: t.String() }) }, ({ query }) => query)
		.post('/b', { body: t.Object({ n: t.Number() }) }, ({ body }) => body)
		.get(
			'/h',
			{ headers: t.Object({ 'x-n': t.String() }) },
			({ headers }) => headers['x-n']
		)

const json = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
})

describe('TypeBox Validator without buildResult (#2001)', () => {
	for (const [name, make] of [
		['.compile()', () => app().compile()],
		['precompile: true', () => app({ precompile: true })]
	] as const)
		it(`${name} compiles and validates routes with a schema`, async () => {
			withoutBuildResult()

			const server = make()

			expect((await server.handle('/n/1')).status).toBe(200)
			expect(await (await server.handle('/n/1')).json()).toEqual({
				id: 1
			})
			expect((await server.handle('/n/x')).status).toBe(422)
			expect((await server.handle('/q?n=a')).status).toBe(200)
			expect((await server.handle('/q')).status).toBe(422)
			expect((await server.handle('/b', json({ n: 1 }))).status).toBe(200)
			expect((await server.handle('/b', json({ n: 'x' }))).status).toBe(
				422
			)
			expect(
				(await server.handle('/h', { headers: { 'x-n': 'a' } })).status
			).toBe(200)
			expect((await server.handle('/h')).status).toBe(422)
		})

	// `isAsync` comes from the build externals. Defaulting it to false when
	// `buildResult` is missing would skip the async file-type check, so a
	// file of the wrong type would pass validation
	it('still detects an async file-type check on an eager validator', () => {
		withoutBuildResult()

		const v = new TypeBoxValidator(
			t.Object({ f: t.File({ type: 'image' }) }),
			{ eager: true }
		)

		expect(v.tb).toBeDefined()
		expect(v.isAsync).toBe(true)
	})

	// A compiled Validator passed as a route schema must still get the
	// descriptive error, not the generic "support only TypeBox" fallthrough
	it('names a compiled typebox/schema Validator passed as a schema', () => {
		const compiled: any = schema.Compile(t.Object({ n: t.String() }))
		delete compiled.buildResult

		expect(() =>
			new Elysia()
				.post('/x', { body: compiled }, ({ body }: any) => body)
				.compile()
		).toThrow(/Compiled schema detected/)
	})

	it('reports a plain eager validator as synchronous', () => {
		withoutBuildResult()

		const v = new TypeBoxValidator(t.Object({ n: t.String() }), {
			eager: true
		})

		expect(v.tb).toBeDefined()
		expect(v.isAsync).toBe(false)
	})
})

/**
 * A merged validator checks each TypeBox member with its own
 * `typebox/compile` Validator and read async-ness off its `buildResult`.
 * Without one it took every member as synchronous, so the content check of
 * `t.File({ type })` was never awaited and a mislabelled file passed
 */
describe('merged TypeBox member without buildResult', () => {
	afterEach(() => {
		useTypebox(live as any)
		setFileTypeDetector(fileTypeFromBlob)
	})

	it('still awaits the file-type check of a merged member', async () => {
		useTypebox({
			...live,
			Compile: ((s: any) => {
				const v: any = compile.Compile(s)
				delete v.buildResult

				return v
			}) as any
		} as any)
		setFileTypeDetector(() => 'text/plain')

		const app = new Elysia()
			.guard({
				schema: 'merge',
				body: z.object({ b: z.string() })
			} as any)
			.post(
				'/',
				{
					body: t.Union([
						t.Object({
							f: t.File({ type: 'image' }),
							b: t.String()
						})
					])
				},
				() => 'ok'
			)

		const body = new FormData()
		body.append('f', new File(['x'], 'x.png', { type: 'image/png' }))
		body.append('b', 'y')

		const response = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)

		expect(response.status).toBe(422)
	})
})
