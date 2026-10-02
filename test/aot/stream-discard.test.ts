import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { materialise, materialiseHandlers, registerManifest } from './_manifest'

// The frozen lane replays the JIT's stream exits: an abort stops the observed
// stream, an error exit leaves it to the error hook (see
// test/lifecycle/dispose-stream.test.ts for the why)

beforeEach(() => {
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

const frozen = (build: () => any) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	build().compile()
	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	// the rebuild must serve the captured code, not a fresh JIT compile
	expect(handlers).toHaveLength(1)
	Validator.clear()
	registerManifest({
		handlers: materialiseHandlers(handlers),
		validators: materialise(validators)
	})

	return build().compile()
}

describe('AOT: observed stream exits', () => {
	it('releases an endless stream when the request aborts before it is sent', async () => {
		let log: string[] = []
		let controller = new AbortController()
		const app = frozen(() =>
			new Elysia()
				.derive(() => ({
					db: {
						[Symbol.dispose]() {
							log.push('dispose')
						}
					}
				}))
				.get('/csv', async () => {
					controller.abort()
					await Bun.sleep(1)

					return new ReadableStream({
						pull(c) {
							c.enqueue('x')
						},
						cancel() {
							log.push('cancel')
						}
					})
				})
		)

		log = []
		controller = new AbortController()
		await app.handle(
			new Request('http://localhost/csv', { signal: controller.signal })
		)
		await Bun.sleep(10)
		expect(log).toEqual(['cancel', 'dispose'])
	})

	it('keeps a stream an error hook recovers from responseValue', async () => {
		let log: string[] = []
		let saved: unknown
		const app = frozen(() =>
			new Elysia()
				.error(({ status }) => status(200, saved as any))
				.afterResponse(() => {
					log.push('afterResponse')
				})
				.afterHandle(({ responseValue }) => {
					saved = responseValue
				})
				.afterHandle(() => {
					throw new Error('recover')
				})
				.get('/', async function* () {
					try {
						yield 'kept'
					} finally {
						log.push('finally')
					}
				})
		)

		log = []
		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('kept')
		await Bun.sleep(10)
		expect(log).toEqual(['finally', 'afterResponse'])
	})
})
