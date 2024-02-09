import { describe, it, expect } from 'bun:test'
import { findAlias } from '../../src/sucrose'

describe('find alias', () => {
	it('find aliases of a variable in a simple function body', () => {
		const type = 'body'
		const body = '{ const a = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a function body with multiple assignments', () => {
		const type = 'body'
		const body = `{ const a = body; const b = body }`

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a function body with object destructuring as-is', () => {
		const type = 'body'
		const body = '{ const { a, b } = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['{ a, b }'])
	})

	it('return an empty array when the variable is not found in the function body', () => {
		const type = 'body'
		const body = '{ const a = otherVariable }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual([])
	})

	it('handle a function body with no content', () => {
		const type = 'body'
		const body = ''

		const aliases = findAlias(type, body)
		expect(aliases).toEqual([])
	})

	it('handle a function body with only one line', () => {
		const type = 'body'
		const body = 'const a = body'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a'])
	})

	it('find aliases of a variable in a nested function body', () => {
		const type = 'body'
		const body = '{ const a = body, b = { const c = body, d = body } }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'c', 'd'])
	})

	it('find aliases of a variable in a function body with comments', () => {
		const type = 'body'
		const body = '{ const a = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a function body with multiple lines', () => {
		const type = 'body'
		const body = '{ const a = body,\n  b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a nested function body', () => {
		const type = 'body'
		const body = '{ const a = body, b = { const c = body, d = body } }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'c', 'd'])
	})

	it('find aliases of a variable in a function body with mixed quotes', () => {
		const type = 'body'
		const body = '{ const a = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('handle aliases of a variable in a function body with mixed spaces and tabs', () => {
		const type = 'body'
		const body = '{ const a = body,\tb = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a simple function body', () => {
		const type = 'body'
		const body = '{ const a = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a simple function body', () => {
		const type = 'body'
		const body = '{ const a = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a function body with a variable name that starts with an underscore', () => {
		const type = '_body'
		const body = '{ const _a = _body, _b = _body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['_a', '_b'])
	})

	it('find aliases of a variable in a function body with a variable name that starts with a number', () => {
		const type = 'body'
		const body = '{ const 1a = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['1a', 'b'])
	})

	it('find aliases of a variable in a function body with a variable name that contains a dot', () => {
		const type = 'body'
		const body = '{ const a.b = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a.b', 'b'])
	})

	it('find aliases of a variable in a function body with a hyphenated variable name', () => {
		const type = 'body'
		const body = '{ const a-b = body, b = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a-b', 'b'])
	})

	it('find aliases of a variable in a function body with a variable name that contains a dollar sign', () => {
		const type = 'body'
		const body = '{ const $a = body, b = $a }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['$a', 'b'])
	})
})
