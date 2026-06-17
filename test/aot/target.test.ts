import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'

// A `headers` validator makes the handler codegen emit the header-materialization
// line — `c.headers = c.request.headers.toJSON()` (Bun) vs
// `Object.fromEntries(c.request.headers)` (Node/workerd). It's the only const
// baked from the BUILD runtime, so before the `target` option a workerd deploy
// had to be generated under Node. These tests run under Bun, so forcing
// `fromEntries` via target proves the override beats the build runtime.
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

describe('AOT target option — build-target-baked header path', () => {
	it("target: 'workerd' bakes Object.fromEntries even when built on Bun", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'workerd'
		})

		expect(src).toInclude(FROM_ENTRIES)
		expect(src).not.toInclude(TOJSON)
	})

	it("target: 'node' bakes Object.fromEntries", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'node'
		})

		expect(src).toInclude(FROM_ENTRIES)
		expect(src).not.toInclude(TOJSON)
	})

	it("target: 'bun' bakes Headers.toJSON", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'bun'
		})

		expect(src).toInclude(TOJSON)
		expect(src).not.toInclude(FROM_ENTRIES)
	})
})
