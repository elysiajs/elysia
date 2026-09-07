import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from '../aot/_manifest'

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	endHandlerCapture()
	endValidatorCapture()
	Compiled.clear()
})

for (const lane of ['jit', 'aot'])
	describe(`${lane}: shared stream completion observer`, () => {
		const build = (
			generator: () => AsyncGenerator<Uint8Array>,
			events: string[],
			errors: unknown[]
		) => {
			const create = () =>
				new Elysia()
					.use(trace())
					.trace(({ onHandle }) => {
						onHandle(({ onStop }) =>
							onStop(({ error }) => {
								errors.push(error)
								events.push('handle')
							})
						)
					})
					.afterResponse(() => {
						events.push('afterResponse')
					})
					.get('/', generator)
			if (lane === 'aot') {
				process.env.ELYSIA_AOT_BUILD = '1'
				create().compile()
				const handlers = endHandlerCapture()
				const validators = endValidatorCapture()
				expect(handlers).toHaveLength(1)
				registerManifest({
					validators: materialise(validators),
					handlers: materialiseHandlers(handlers)
				})
				delete process.env.ELYSIA_AOT_BUILD
			}
			return create()
		}

		for (const [chunks, bytes] of [
			[100, 1],
			[8, 1 << 20]
		])
			it(`finishes ${chunks} chunks of ${bytes} bytes before both completion hooks`, async () => {
				let produced = 0
				let finalized = 0
				const events: string[] = []
				const errors: unknown[] = []
				const app = build(
					async function* () {
						try {
							for (let i = 0; i < chunks; i++) {
								produced++
								yield new Uint8Array(bytes)
							}
						} finally {
							finalized++
						}
					},
					events,
					errors
				)
				const controller = new AbortController()
				const response = await app.handle(
					new Request('http://localhost/', {
						signal: controller.signal
					})
				)
				const timeout = setTimeout(() => controller.abort(), 1_000)
				try {
					expect((await response.arrayBuffer()).byteLength).toBe(
						chunks * bytes
					)
					await Bun.sleep(0)
					expect(produced).toBe(chunks)
					expect(finalized).toBe(1)
					expect(events).toEqual(['handle', 'afterResponse'])
					expect(errors).toEqual([null])
				} finally {
					clearTimeout(timeout)
					controller.abort()
				}
			})

		for (const failureAt of [0, 80])
			it(`reports a source error after ${failureAt} chunks and completes both hooks once`, async () => {
				const events: string[] = []
				const errors: unknown[] = []
				const failure = new Error('source failed')
				let finalized = 0
				const app = build(
					async function* () {
						try {
							for (let i = 0; i < failureAt; i++)
								yield new Uint8Array(1)
							throw failure
						} finally {
							finalized++
						}
					},
					events,
					errors
				)
				const controller = new AbortController()
				const response = await app.handle(
					new Request('http://localhost/', {
						signal: controller.signal
					})
				)
				const timeout = setTimeout(() => controller.abort(), 1_000)
				try {
					if (failureAt)
						await expect(response.arrayBuffer()).rejects.toBe(
							failure
						)
					else {
						expect(response.status).toBe(500)
						await response.arrayBuffer()
					}
					await Bun.sleep(0)
					expect(events).toEqual(['handle', 'afterResponse'])
					expect(errors).toEqual([failure])
					expect(finalized).toBe(1)
				} finally {
					clearTimeout(timeout)
					controller.abort()
				}
			})

		it('cancels the source and completes both hooks once on client abort', async () => {
			const events: string[] = []
			const errors: unknown[] = []
			let finalized = 0
			const app = build(
				async function* () {
					try {
						while (true) yield new Uint8Array(1)
					} finally {
						finalized++
					}
				},
				events,
				errors
			)
			const controller = new AbortController()
			const response = await app.handle(
				new Request('http://localhost/', { signal: controller.signal })
			)
			const reader = response.body!.getReader()
			await reader.read()
			controller.abort()
			await reader.cancel()
			reader.releaseLock()
			await Bun.sleep(0)
			expect(events).toEqual(['handle', 'afterResponse'])
			expect(finalized).toBe(1)
		})
	})
