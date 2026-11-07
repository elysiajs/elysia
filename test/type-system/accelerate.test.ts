import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('TypeSystem - Accelerate', () => {
	it('prefers toJSONSchema() over toJsonSchema() and ~standard', () => {
		let toJsonSchemaCalled = false
		let standardCalled = false

		const schema = {
			toJSONSchema: () => ({ type: 'string' }),
			toJsonSchema: () => {
				toJsonSchemaCalled = true
				return { type: 'number' }
			},
			'~standard': {
				jsonSchema: {
					input: () => {
						standardCalled = true
						return { type: 'boolean' }
					},
					output: () => ({ type: 'boolean' })
				}
			}
		}

		const result = t.Accelerate(schema as any)

		expect(result).toEqual({ type: 'string', '~elyAcl': true })
		expect(toJsonSchemaCalled).toBe(false)
		expect(standardCalled).toBe(false)
	})

	it('falls back to toJsonSchema() when toJSONSchema is absent', () => {
		let standardCalled = false

		const schema = {
			toJsonSchema: () => ({ type: 'number' }),
			'~standard': {
				jsonSchema: {
					input: () => {
						standardCalled = true
						return { type: 'boolean' }
					},
					output: () => ({ type: 'boolean' })
				}
			}
		}

		const result = t.Accelerate(schema as any)

		expect(result).toEqual({ type: 'number', '~elyAcl': true })
		expect(standardCalled).toBe(false)
	})

	it('falls back to ~standard.jsonSchema.input() when neither method exists', () => {
		let inputParams: unknown

		const schema = {
			'~standard': {
				jsonSchema: {
					input: (params: { target: string }) => {
						inputParams = params
						return { type: 'boolean' }
					},
					output: () => ({ type: 'boolean' })
				}
			}
		}

		const result = t.Accelerate(schema as any)

		expect(result).toEqual({ type: 'boolean', '~elyAcl': true })
		expect(inputParams).toEqual({ target: 'draft-2020-12' })
	})

	it('clones a frozen JSON schema instead of mutating it', () => {
		const raw = Object.freeze({ type: 'string' })
		const schema = { toJSONSchema: () => raw }

		const result = t.Accelerate(schema as any)

		expect(result).not.toBe(raw)
		expect(result).toEqual({ type: 'string', '~elyAcl': true })
		expect('~elyAcl' in raw).toBe(false)
	})

	it('mutates a non-frozen JSON schema in place instead of cloning', () => {
		const raw: Record<string, unknown> = { type: 'string' }
		const schema = { toJSONSchema: () => raw }

		const result = t.Accelerate(schema as any)

		expect(result).toBe(raw)
		expect(raw['~elyAcl']).toBe(true)
	})

	it('validates request bodies through a route using the accelerated schema', async () => {
		const jsonSchema = {
			type: 'object',
			properties: { name: { type: 'string' } },
			required: ['name'],
			additionalProperties: false
		}

		const schema = { toJSONSchema: () => jsonSchema }

		const app = new Elysia().post(
			'/',
			{ body: t.Accelerate(schema as any) as any },
			({ body }) => body
		)

		const ok = await app.handle('/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'saltyaom' })
		})
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'saltyaom' })

		const missingRequired = await app.handle('/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		})
		expect(missingRequired.status).toBe(422)
	})
})
