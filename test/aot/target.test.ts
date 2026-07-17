import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { compileToSource } from '../../src/plugin/aot/source'

/** The AOT target selects the runtime-specific header extraction it emits. */
const build = () =>
	new Elysia()
		.beforeHandle(() => {})
		.get(
			'/',
			{ headers: t.Object({ 'x-id': t.Optional(t.String()) }) },
			({ headers }) => headers['x-id'] ?? 'ok'
		)

const TOJSON = 'c.request.headers.toJSON()'
const FROM_ENTRIES = 'Object.fromEntries(c.request.headers)'

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

describe('AOT target-specific header extraction', () => {
	it("emits Object.fromEntries for target: 'workerd' even when built on Bun", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'workerd'
		})

		expect(src).toInclude(FROM_ENTRIES)
		expect(src).not.toInclude(TOJSON)
	})

	it("emits Object.fromEntries for target: 'node'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'node'
		})

		expect(src).toInclude(FROM_ENTRIES)
		expect(src).not.toInclude(TOJSON)
	})

	it("emits Headers.toJSON for target: 'bun'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'bun'
		})

		expect(src).toInclude(TOJSON)
		expect(src).not.toInclude(FROM_ENTRIES)
	})
})
