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
		// findAlias scans text, it does not lex, so `= body` inside a line or
		// block comment yields an alias just like a real declaration does.
		// Over-approximating is the safe direction: trace.ts bails to the
		// conservative path on any non-destructure alias, so this noise can
		// widen inference but never narrow it.
		const body = `{
		// const fromLine = body
		const a = body
		/* const fromBlock = body */
		const b = body
	}`

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['fromLine', 'a', 'fromBlock', 'b'])
	})

	it('find aliases of a variable in a function body with multiple lines', () => {
		const type = 'body'
		// Comma-first style: the newline sits immediately after `= body` so
		// findEndIndex's terminator switch meets \n directly (case 10, not the
		// comma that used to sit there), and the second newline sits
		// immediately before `b` so the backward boundary scan also meets \n
		// directly (case 10) instead of stopping at an intervening space.
		const body = '{ const a = body\n,\nb = body }'

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', 'b'])
	})

	it('find aliases of a variable in a function body with mixed quotes', () => {
		const type = 'body'
		// Quote characters are not delimiters, so a quoted lookalike only
		// escapes when the character after it is one — "x = body" and
		// `y = body` are inert, while 'z = body, w' matches on the comma and
		// leaks `'z`, which then resolves its holder `u` on the recursive pass.
		const body = `{ const a = body, s = "x = body", t = \`y = body\`, u = 'z = body, w' }`

		const aliases = findAlias(type, body)
		expect(aliases).toEqual(['a', "'z", 'u'])
	})

	it('handle aliases of a variable in a function body with mixed spaces and tabs', () => {
		const type = 'body'
		// Tab-first style: the tab sits immediately after `= body` so
		// findEndIndex's terminator switch meets \t directly (case 9, not the
		// comma that used to sit there), and a second tab sits immediately
		// before `b` so the backward boundary scan also meets \t directly
		// (case 9) instead of stopping at an intervening space.
		const body = '{ const a = body\t,\tb = body }'

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
