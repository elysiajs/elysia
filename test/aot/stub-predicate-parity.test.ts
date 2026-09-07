// Strip mode reimplements this predicate, so both copies must return the same result.

import { describe, expect, it } from 'bun:test'

import { isEmptyPipelineHook } from '../../src/compile/handler/descriptor'
import { STUB_SOURCES } from '../../src/plugin/aot/core'

const DESCRIPTOR_MODULE =
	'/x/node_modules/elysia/dist/compile/handler/descriptor.mjs'

const stub = STUB_SOURCES.jit.find(({ filter }) =>
	filter.test(DESCRIPTOR_MODULE)
)

if (!stub) throw new Error('no strip-mode descriptor stub found')

const stubbed = (await import(
	`data:text/javascript;base64,${Buffer.from(stub.source).toString('base64')}`
)) as {
	isEmptyPipelineHook: typeof isEmptyPipelineHook
}

const fn = () => {}

const shapes: [string, any][] = [
	['undefined hook', undefined],
	['empty hook', {}],
	['error hook', { error: [fn] }],
	['detail and tags only', { detail: { summary: 'x' }, tags: ['a'] }],
	['empty arrays', { error: [], afterResponse: [] }],
	['explicit false', { parse: false }],
	['explicit undefined', { transform: undefined }],
	['error and afterResponse', { error: [fn], afterResponse: [fn] }],
	['unknown hook key', { somethingNew: [fn] }]
]

describe('AOT strip-mode stub mirrors the live isEmptyPipelineHook', () => {
	for (const [name, hook] of shapes)
		it(`agrees on ${name}`, () => {
			expect(stubbed.isEmptyPipelineHook(hook)).toBe(
				isEmptyPipelineHook(hook)
			)
		})

	it('is not vacuous — the shapes cover both answers', () => {
		const answers = new Set(
			shapes.map(([, hook]) => stubbed.isEmptyPipelineHook(hook))
		)

		expect(answers).toEqual(new Set([true, false]))
	})

	it('the stub really is a second implementation, not a re-export', () => {
		expect(stubbed.isEmptyPipelineHook).not.toBe(isEmptyPipelineHook)
		expect(stub.source).toContain('isEmptyPipelineHook')
	})
})
