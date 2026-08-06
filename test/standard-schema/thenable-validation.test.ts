import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'

type Result = { value: unknown } | { issues: { message: string }[] }
type PromiseBehavior =
	| 'native'
	| 'native-reject'
	| 'custom'
	| 'custom-reject'
	| 'throwing-getter'

const thenableSchema = (behavior: PromiseBehavior, result?: Result) => {
	let calls = 0
	const rejected = new Error('validator rejected')

	return {
		schema: {
			'~standard': {
				version: 1,
				vendor: 'thenable-validation-test',
				validate: () => {
					calls++

					if (behavior === 'native') return Promise.resolve(result!)
					if (behavior === 'native-reject')
						return Promise.reject(rejected)
					if (behavior === 'custom-reject')
						return {
							then: (
								_resolve: unknown,
								reject: (error: Error) => void
							) => reject(rejected)
						}
					if (behavior === 'throwing-getter')
						return Object.defineProperty({}, 'then', {
							get() {
								throw new Error('then getter failed')
							}
						})

					return {
						then: (resolve: (value: Result) => void) =>
							resolve(result!)
					}
				}
			}
		} as any,
		calls: () => calls
	}
}

const validateRequest = async (behavior: PromiseBehavior, result?: Result) => {
	const validator = thenableSchema(behavior, result)
	const app = new Elysia().post(
		'/',
		{ body: validator.schema },
		({ body }) => body
	)
	const response = await app.handle(
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ marker: 'request' })
		})
	)

	return { response, calls: validator.calls() }
}

const validateResponse = async (behavior: PromiseBehavior, result?: Result) => {
	const validator = thenableSchema(behavior, result)
	const app = new Elysia().get('/', { response: validator.schema }, () => ({
		marker: 'response'
	}))
	const response = await app.handle(new Request('http://localhost/'))

	return { response, calls: validator.calls() }
}

const passing = (marker: string): Result => ({ value: { accepted: marker } })
const failing: Result = { issues: [{ message: 'validation failed' }] }

// Standard Schema accepts Promise-like validation results, not only native Promises.
describe('request validation with Promise-like results', () => {
	it('keeps native Promise pass and fail behavior', async () => {
		const pass = await validateRequest('native', passing('request'))
		const fail = await validateRequest('native', failing)

		expect(pass.response.status).toBe(200)
		await expect(pass.response.json()).resolves.toEqual({
			accepted: 'request'
		})
		expect(fail.response.status).toBe(422)
		expect(pass.calls).toBe(1)
		expect(fail.calls).toBe(1)
	})

	it('rejects a failing custom thenable identically to a native Promise', async () => {
		const native = await validateRequest('native', failing)
		const custom = await validateRequest('custom', failing)

		expect(custom.response.status).toBe(422)
		await expect(custom.response.text()).resolves.toBe(
			await native.response.text()
		)
		expect(custom.calls).toBe(1)
	})

	it('uses the value from a passing custom thenable', async () => {
		const { response, calls } = await validateRequest(
			'custom',
			passing('request')
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ accepted: 'request' })
		expect(calls).toBe(1)
	})

	it('handles custom thenable rejection like native Promise rejection', async () => {
		const native = await validateRequest('native-reject')
		const custom = await validateRequest('custom-reject')

		expect(custom.response.status).toBe(native.response.status)
		await expect(custom.response.text()).resolves.toBe(
			await native.response.text()
		)
		expect(custom.calls).toBe(1)
	})

	it('propagates a throwing then getter instead of silently passing', async () => {
		const { response, calls } = await validateRequest('throwing-getter')

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toMatchObject({
			detail: 'then getter failed'
		})
		expect(calls).toBe(1)
	})
})

describe('response validation with Promise-like results', () => {
	it('keeps native Promise pass and fail behavior', async () => {
		const pass = await validateResponse('native', passing('response'))
		const fail = await validateResponse('native', failing)

		expect(pass.response.status).toBe(200)
		await expect(pass.response.json()).resolves.toEqual({
			accepted: 'response'
		})
		expect(fail.response.status).toBe(422)
		expect(pass.calls).toBe(1)
		expect(fail.calls).toBe(1)
	})

	it('rejects a failing custom thenable identically to a native Promise', async () => {
		const native = await validateResponse('native', failing)
		const custom = await validateResponse('custom', failing)

		expect(custom.response.status).toBe(422)
		await expect(custom.response.text()).resolves.toBe(
			await native.response.text()
		)
		expect(custom.calls).toBe(1)
	})

	it('uses the value from a passing custom thenable', async () => {
		const { response, calls } = await validateResponse(
			'custom',
			passing('response')
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ accepted: 'response' })
		expect(calls).toBe(1)
	})

	it('handles custom thenable rejection like native Promise rejection', async () => {
		const native = await validateResponse('native-reject')
		const custom = await validateResponse('custom-reject')

		expect(custom.response.status).toBe(native.response.status)
		await expect(custom.response.text()).resolves.toBe(
			await native.response.text()
		)
		expect(custom.calls).toBe(1)
	})

	it('propagates a throwing then getter instead of silently passing', async () => {
		const { response, calls } = await validateResponse('throwing-getter')

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toMatchObject({
			detail: 'then getter failed'
		})
		expect(calls).toBe(1)
	})
})

it('sync-only Standard and Multi validators reject any thenable', () => {
	const standard = Validator.create(
		thenableSchema('custom', passing('sync')).schema
	)!
	const multi = Validator.create(
		thenableSchema('custom', passing('sync')).schema,
		{ schemas: [t.String()] }
	)!
	const message =
		'[Elysia] An asynchronous Standard Schema was used where only synchronous validation is supported.'

	expect(() => standard.Check('value')).toThrow(message)
	expect(() => multi.Check('value')).toThrow(message)
})
