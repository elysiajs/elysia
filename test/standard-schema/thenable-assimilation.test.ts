import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'

type Result = { value: unknown } | { issues: { message: string }[] }
type Mode =
	| 'native'
	| 'native-reject'
	| 'thenable'
	| 'reject'
	| 'throwing-getter'

const schema = (mode: Mode, result?: Result) => {
	let calls = 0
	const rejected = new Error('validator rejected')

	return {
		schema: {
			'~standard': {
				version: 1,
				vendor: 'thenable-assimilation-test',
				validate: () => {
					calls++

					if (mode === 'native') return Promise.resolve(result!)
					if (mode === 'native-reject')
						return Promise.reject(rejected)
					if (mode === 'reject')
						return {
							then: (
								_resolve: unknown,
								reject: (error: Error) => void
							) => reject(rejected)
						}
					if (mode === 'throwing-getter')
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

const bodyResponse = async (mode: Mode, result?: Result) => {
	const validator = schema(mode, result)
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

const outputResponse = async (mode: Mode, result?: Result) => {
	const validator = schema(mode, result)
	const app = new Elysia().get('/', { response: validator.schema }, () => ({
		marker: 'response'
	}))
	const response = await app.handle(new Request('http://localhost/'))

	return { response, calls: validator.calls() }
}

const passing = (marker: string): Result => ({ value: { accepted: marker } })
const failing: Result = { issues: [{ message: 'validation failed' }] }

describe('Standard Schema request thenable assimilation', () => {
	it('keeps native Promise pass and fail behavior', async () => {
		const pass = await bodyResponse('native', passing('request'))
		const fail = await bodyResponse('native', failing)

		expect(pass.response.status).toBe(200)
		expect(await pass.response.json()).toEqual({ accepted: 'request' })
		expect(fail.response.status).toBe(422)
		expect(pass.calls).toBe(1)
		expect(fail.calls).toBe(1)
	})

	it('rejects a failing custom thenable identically to a native Promise', async () => {
		const native = await bodyResponse('native', failing)
		const custom = await bodyResponse('thenable', failing)

		expect(custom.response.status).toBe(422)
		expect(await custom.response.text()).toBe(await native.response.text())
		expect(custom.calls).toBe(1)
	})

	it('uses the value from a passing custom thenable', async () => {
		const { response, calls } = await bodyResponse(
			'thenable',
			passing('request')
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ accepted: 'request' })
		expect(calls).toBe(1)
	})

	it('handles custom thenable rejection like native Promise rejection', async () => {
		const native = await bodyResponse('native-reject')
		const custom = await bodyResponse('reject')

		expect(custom.response.status).toBe(native.response.status)
		expect(await custom.response.text()).toBe(await native.response.text())
		expect(custom.calls).toBe(1)
	})

	it('propagates a throwing then getter instead of silently passing', async () => {
		const { response, calls } = await bodyResponse('throwing-getter')

		expect(response.status).toBe(500)
		expect(await response.json()).toMatchObject({
			detail: 'then getter failed'
		})
		expect(calls).toBe(1)
	})
})

describe('Standard Schema response thenable assimilation', () => {
	it('keeps native Promise pass and fail behavior', async () => {
		const pass = await outputResponse('native', passing('response'))
		const fail = await outputResponse('native', failing)

		expect(pass.response.status).toBe(200)
		expect(await pass.response.json()).toEqual({ accepted: 'response' })
		expect(fail.response.status).toBe(422)
		expect(pass.calls).toBe(1)
		expect(fail.calls).toBe(1)
	})

	it('rejects a failing custom thenable identically to a native Promise', async () => {
		const native = await outputResponse('native', failing)
		const custom = await outputResponse('thenable', failing)

		expect(custom.response.status).toBe(422)
		expect(await custom.response.text()).toBe(await native.response.text())
		expect(custom.calls).toBe(1)
	})

	it('uses the value from a passing custom thenable', async () => {
		const { response, calls } = await outputResponse(
			'thenable',
			passing('response')
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ accepted: 'response' })
		expect(calls).toBe(1)
	})

	it('handles custom thenable rejection like native Promise rejection', async () => {
		const native = await outputResponse('native-reject')
		const custom = await outputResponse('reject')

		expect(custom.response.status).toBe(native.response.status)
		expect(await custom.response.text()).toBe(await native.response.text())
		expect(custom.calls).toBe(1)
	})

	it('propagates a throwing then getter instead of silently passing', async () => {
		const { response, calls } = await outputResponse('throwing-getter')

		expect(response.status).toBe(500)
		expect(await response.json()).toMatchObject({
			detail: 'then getter failed'
		})
		expect(calls).toBe(1)
	})
})

it('sync-only Standard and Multi validators reject any thenable', () => {
	const standard = Validator.create(
		schema('thenable', passing('sync')).schema
	)!
	const multi = Validator.create(schema('thenable', passing('sync')).schema, {
		schemas: [t.String()]
	})!
	const message =
		'[Elysia] An asynchronous Standard Schema was used where only synchronous validation is supported.'

	expect(() => standard.Check('value')).toThrow(message)
	expect(() => multi.Check('value')).toThrow(message)
})
