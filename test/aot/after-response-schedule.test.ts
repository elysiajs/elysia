import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { materialise, materialiseHandlers, registerManifest } from './_manifest'

// AOT and JIT must schedule `afterResponse` after response mapping.

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

const settle = () => Bun.sleep(20)

const build = (log: string[]) =>
	new Elysia().get(
		'/pre',
		{
			afterResponse() {
				log.push('afterResponse')
			},
			error({ error }: any) {
				log.push(`error:${(error as Error).message}`)
			}
		},
		function* () {
			throw new Error('boom')
		}
	)

describe('AOT capture: afterResponse schedule position', () => {
	it('freezes the post-mapping schedule and fires afterResponse once', async () => {
		const captureLog: string[] = []
		;(build(captureLog) as any).compile()

		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers).toHaveLength(1)
		// The schedule must run after mapping produces `_m`.
		expect(handlers[0]!.code).toContain('_sc()\nreturn _m\n')

		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})

		delete process.env.ELYSIA_AOT_BUILD

		const log: string[] = []
		const frozen = build(log)
		;(frozen as any).compile()

		const response = await frozen.handle('/pre')
		expect(response.status).toBe(500)
		try {
			await response.text()
		} catch {}
		await settle()

		expect(log).toEqual(['error:boom', 'afterResponse'])

		Compiled.clear()
		Validator.clear()
		const jitLog: string[] = []
		const jit = build(jitLog)
		;(jit as any).compile()

		const jitResponse = await jit.handle('/pre')
		expect(jitResponse.status).toBe(500)
		try {
			await jitResponse.text()
		} catch {}
		await settle()

		expect(jitLog).toEqual(log)
	})
})
