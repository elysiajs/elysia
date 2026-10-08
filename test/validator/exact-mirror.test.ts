import { Elysia, setupTypebox, t } from '../../src'

import { afterEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { post, json } from '../utils'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	getExactMirror,
	setExactMirror
} from '../../src/type/validator/exact-mirror'
import { Validator } from '../../src/validator'

const installedMirror = getExactMirror()

afterEach(() => {
	setExactMirror(installedMirror)
	Validator.clear()
})

describe('without exact-mirror', () => {
	it('keeps TypeBox normalization available through Value.Clean', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(t.Object({ value: t.String() }))

		expect(validator.Clean!({ value: 'ok', extra: true })).toEqual({
			value: 'ok'
		})
	})

	it('keeps TypeBox codec encode available', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(t.Object({ at: t.Date() }), {
			slot: 'response:200'
		})

		expect(validator.EncodeFrom({ at: new Date(0) })).toEqual({
			at: '1970-01-01T00:00:00.000Z'
		})
	})

	it('keeps TypeBox codec decode available', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(t.Object({ at: t.Date() }))
		const decoded = validator.FromSync({
			at: '1970-01-01T00:00:00.000Z'
		} as any)

		expect(decoded).toEqual({ at: new Date(0) })
	})

	// A named implementation cannot be silently swapped, and sanitize is a
	// security boundary — degrading either without a word is how an app ships
	// unsanitized output. `normalize: true` names no implementation, so a
	// runtime without exact-mirror (a `bun build --compile` binary, where the
	// dynamic require cannot resolve) degrades to TypeBox instead of 500ing
	// every request that creates a validator.
	it('fails loud when exact-mirror behavior is explicitly requested', () => {
		setExactMirror(undefined)
		const schema = t.Object({ value: t.String() })

		expect(
			() => new TypeBoxValidator(schema, { normalize: 'exactMirror' })
		).toThrow('exact-mirror is required')
		expect(
			() =>
				new TypeBoxValidator(schema, {
					sanitize: (value) => value
				})
		).toThrow('exact-mirror is required')
	})

	it('degrades normalize: true to TypeBox instead of throwing', () => {
		setExactMirror(undefined)

		const validator = new TypeBoxValidator(
			t.Object({ value: t.String() }),
			{ normalize: true }
		)

		expect(validator.Clean!({ value: 'ok', extra: true })).toEqual({
			value: 'ok'
		})
	})

	it('allows explicit registration in runtimes without require', () => {
		expect(typeof installedMirror).toBe('function')
		setExactMirror(undefined)
		setupTypebox({ exactMirror: installedMirror })

		expect(getExactMirror()).toBe(installedMirror)
	})
})

// A plugin that builds a validator per request would turn a per-validator
// warning into one log line per request, so the degraded path announces itself
// exactly once. The flag is module state, so only a child process can observe
// the first warning.
describe('degraded normalization warning', () => {
	it('warns once per process, not once per validator', () => {
		const src = resolve(import.meta.dir, '../../src')
		const script =
			`import { t } from '${src}/index.ts'\n` +
			`import { TypeBoxValidator } from '${src}/type/validator/index.ts'\n` +
			`import { setExactMirror } from '${src}/type/validator/exact-mirror.ts'\n` +
			`setExactMirror(undefined)\n` +
			`for (const key of ['a', 'b'])\n` +
			`	new TypeBoxValidator(t.Object({ [key]: t.String() }), { normalize: true })\n`

		const child = spawnSync('bun', ['-e', script], { encoding: 'utf8' })

		expect(child.status).toBe(0)
		expect(
			child.stderr.split('exact-mirror is unavailable').length - 1
		).toBe(1)
	})
})

describe('mirror failure diagnostics', () => {
	// `t.Cookie` parks its HMAC `secrets` on the schema itself, and this warning
	// goes to stderr — into the log pipeline, where it is durable and widely
	// readable. A leaked signing key forges every session cookie it protects, so
	// the report must carry the schema shape and never the key.
	const warningsFor = (schema: any) => {
		setExactMirror(() => {
			throw new Error('mirror generation failed')
		})

		const warn = console.warn
		const logged: unknown[] = []
		console.warn = (...args: unknown[]) => {
			logged.push(...args)
		}

		try {
			new TypeBoxValidator(schema)
		} finally {
			console.warn = warn
		}

		expect(logged[0]).toContain('Failed to create exactMirror')

		return JSON.stringify(logged)
	}

	it('never logs a cookie signing secret', () => {
		const logged = warningsFor(
			t.Cookie(
				{ session: t.String() },
				{ secrets: 'single-signing-key', sign: ['session'] }
			)
		)

		expect(logged).not.toContain('single-signing-key')
		// the diagnostic is still worth reporting
		expect(logged).toContain('session')
	})

	it('never logs a rotating signing secret', () => {
		const logged = warningsFor(
			t.Cookie(
				{ rotated: t.String() },
				{
					secrets: ['rotating-key-old', 'rotating-key-new'],
					sign: ['rotated']
				}
			)
		)

		expect(logged).not.toContain('rotating-key-old')
		expect(logged).not.toContain('rotating-key-new')
	})

	it('never logs a per-field signing secret', () => {
		const logged = warningsFor(
			t.Cookie({
				scoped: t.Cookie(t.String(), { secrets: 'per-field-key' })
			})
		)

		expect(logged).not.toContain('per-field-key')
	})
})

describe('Exact Mirror', () => {
	it('normalize when t.Codec is provided', async () => {
		const app = new Elysia({
			normalize: 'exactMirror'
		}).get(
			'/',
			{
				response: t.Object(
					{ name: t.String(), count: t.Optional(t.Integer()) },
					{ additionalProperties: false }
				)
			},
			() => ({ count: 2, name: 'foo', extra: 1 })
		)
	})

	it('leave incorrect union field as-is', async () => {
		const app = new Elysia().post(
			'/test',
			{
				body: t.Object({
					foo: t.Optional(
						t.Nullable(
							t.Number({
								// 'foo' but be either number, optional or nullable
								error: 'Must be a number'
							})
						)
					)
				})
			},
			({ body }) => {
				console.log({ body })

				return 'Hello Elysia'
			}
		)

		const response = await app.handle(
			'/test', json({
				foo: 'asd'
			})
		)

		expect(response.status).toEqual(422)
	})

	it('normalize array response', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Object({
						messages: t.Array(
							t.Object({
								message: t.String()
							})
						)
					})
				}
			},
			() => {
				return {
					messages: [
						{
							message: 'Hello, world!',
							shouldBeRemoved: true
						}
					]
				}
			}
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual({
			messages: [{ message: 'Hello, world!' }]
		})
	})

	it('normalize t.Array with t.Omit(t.Union) elements', async () => {
		const SharedSchemaA = t.Object({ qux: t.Literal('a') })
		const SharedSchemaB = t.Object({ qux: t.Literal('b') })
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const IntersectSchemaA = t.Intersect([SchemaA, SharedSchemaA])
		const IntersectSchemaB = t.Intersect([SchemaB, SharedSchemaB])

		const UnionSchema = t.Union([IntersectSchemaA, IntersectSchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get(
			'/',
			// @ts-ignore
			{ response: t.Array(OmittedUnionSchema) },
			() => [{ bar: 'asd', baz: true, qux: 'b', foo: 1 }]
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual([{ qux: 'b', foo: 1 }])
	})

	it('normalize t.Omit(t.Union) response', async () => {
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const UnionSchema = t.Union([SchemaA, SchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get(
			'/',
			{
				response: OmittedUnionSchema
			},
			() => ({ baz: true, foo: 1 })
		)

		const response = await app.handle('/')

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ foo: 1 })
	})

	it('normalize t.Omit(t.Union) with multiple status codes', async () => {
		const SchemaA = t.Object({ foo: t.Number() })
		const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })

		const UnionSchema = t.Union([SchemaA, SchemaB])
		const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

		const app = new Elysia().get(
			'/',
			{
				response: {
					200: OmittedUnionSchema
				}
			},
			() => ({ baz: true, foo: 1 })
		)

		const response = await app.handle('/')

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ foo: 1 })
	})
})

// An app without schemas shouldn't pay for loading exact-mirror. Whether it
// loaded is module state, so each case runs in a child process
describe('lazy exact-mirror resolution', () => {
	const observe = (run: string) => {
		const src = resolve(import.meta.dir, '../../src')
		const script =
			`const { Elysia, t } = await import(${JSON.stringify(resolve(src, 'index.ts'))})\n` +
			`const { TypeBoxValidator } = await import(${JSON.stringify(resolve(src, 'type/validator/index.ts'))})\n` +
			`const { getExactMirror, setExactMirror } = await import(${JSON.stringify(resolve(src, 'type/validator/exact-mirror.ts'))})\n` +
			`const loaded = () => require.resolve('exact-mirror', { paths: [${JSON.stringify(src)}] }) in require.cache\n` +
			run

		const child = spawnSync(process.execPath, ['-e', script], {
			encoding: 'utf8'
		})

		expect(child.stderr).toBe('')
		expect(child.status).toBe(0)

		return JSON.parse(child.stdout)
	}

	it('loads on the first validator that normalizes, not at import', () => {
		expect(
			observe(
				`const afterImport = loaded()\n` +
					`const app = new Elysia().get('/', () => 'ok')\n` +
					`await app.handle(new Request('http://localhost/'))\n` +
					`const afterRequest = loaded()\n` +
					`new TypeBoxValidator(t.Object({ a: t.String() }))\n` +
					`console.log(JSON.stringify({ afterImport, afterRequest, afterValidator: loaded(), mirror: typeof getExactMirror() }))`
			)
		).toEqual({
			afterImport: false,
			afterRequest: false,
			afterValidator: true,
			mirror: 'function'
		})
	})

	it('is not loaded by validators that opt out of it', () => {
		expect(
			observe(
				`new TypeBoxValidator(t.Object({ a: t.String() }), { normalize: false })\n` +
					`new TypeBoxValidator(t.Object({ b: t.String() }), { normalize: 'typebox' })\n` +
					`console.log(JSON.stringify({ loaded: loaded() }))`
			)
		).toEqual({ loaded: false })
	})

	// setupTypebox({ exactMirror }) and runtimes that can't load it register
	// before first use: that registration wins, the package is never resolved
	it('keeps a registration made before first use', () => {
		expect(
			observe(
				`setExactMirror(undefined)\n` +
					`new TypeBoxValidator(t.Object({ a: t.String() }))\n` +
					`let required = false\n` +
					`try { new TypeBoxValidator(t.Object({ b: t.String() }), { normalize: 'exactMirror' }) }\n` +
					`catch (error) { required = error.message.includes('exact-mirror is required') }\n` +
					`console.log(JSON.stringify({ mirror: typeof getExactMirror(), loaded: loaded(), required }))`
			)
		).toEqual({ mirror: 'undefined', loaded: false, required: true })
	})
})
