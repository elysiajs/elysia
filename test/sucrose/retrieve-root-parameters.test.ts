import { describe, it, expect } from 'bun:test'
import { retrieveRootparameters } from '../../src/sucrose'

describe('retrieve root parameter', () => {
	it('return an empty string when given an empty string', () => {
		const parameter = ''
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: {},
			hasParenthesis: false
		})
	})

	it('remove brackets and their contents when they are at the root level', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { hello: true, elysia: true },
			hasParenthesis: true
		})
	})

	it('return an empty string when given only brackets', () => {
		const parameter = '()'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: {},
			hasParenthesis: false
		})
	})

	it('return an empty string when given only one bracket', () => {
		const parameter = '('
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: {},
			hasParenthesis: false
		})
	})

	it('return the root parameters when given a string with spaces between brackets', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { hello: true, elysia: true },
			hasParenthesis: true
		})
	})

	it('return parameter on minified bracket', () => {
		const parameter = '({ hello, path })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { hello: true, path: true },
			hasParenthesis: true
		})
	})

	it('handle tab and new line', () => {
		const parameter = '({ hello: { world: { a } }, \nelysia, \teden })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { hello: true, elysia: true, eden: true },
			hasParenthesis: true
		})
	})

	// `Function.prototype.toString` hands back the source verbatim, so a handler
	// authored on Windows arrives CRLF-separated. A `\r` left in a name makes
	// every lookup against that name miss — for trace that silently turns every
	// phase off rather than failing.
	it('handle carriage return', () => {
		const parameter = '({\r\n\tonHandle,\r\n\tonError\r\n})'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { onHandle: true, onError: true },
			hasParenthesis: true
		})
	})

	// Whitespace is whatever JavaScript says it is, not the three characters
	// that happen to appear in LF-formatted source.
	it('handle every whitespace character', () => {
		for (const space of [
			' ',
			'\t',
			'\n',
			'\r',
			'\v',
			'\f',
			' ',
			' ',
			' ',
			' ',
			' ',
			' ',
			' ',
			'　',
			'﻿'
		]) {
			const parameter = `({${space}hello,${space}path${space}})`
			const result = retrieveRootparameters(parameter)
			expect(result).toEqual({
				parameters: { hello: true, path: true },
				hasParenthesis: true
			})
		}
	})

	// `hasParenthesis` selects the destructure branch of the trace scanner, so
	// an answer that flips with formatting changes what is inferred. Leading
	// whitespace is legal in `( { a } ) => …` and must not decide it.
	it('detect a destructure behind leading whitespace', () => {
		const parameter = ' { a, b }'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, b: true },
			hasParenthesis: true
		})
	})

	// The same pattern, and the same answer, whether or not a default happens to
	// be present — a default used to normalise the leading whitespace as a side
	// effect, which made the two disagree.
	it('detect a destructure behind leading whitespace with a default', () => {
		const parameter = ' { a = 1, b }'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, b: true },
			hasParenthesis: true
		})
	})

	// A `/` after a string is division. Read as a regex it runs to the next `/`,
	// swallowing the comma that ends the default and dropping the parameter
	// between — inference then misses a context field the handler does use.
	it('not drop a parameter after a division inside a string default', () => {
		const parameter = "({ a = 'x' / 2, b = 'y' / 3, c })"
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, b: true, c: true },
			hasParenthesis: true
		})
	})

	// A comma inside a default value is part of that value, not a parameter separator.
	// Splitting on it would register the tail of the value as a phantom parameter,
	// which would make inference report a context field the handler never uses.
	it('not leak the tail of a default value as a parameter', () => {
		const parameter = '({ body = [1,2], set })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { body: true, set: true },
			hasParenthesis: true
		})
	})

	// The default is dismantled before the pattern is, otherwise the bracket
	// extraction splits the chunk mid-expression. `body` here is an argument of
	// the default's call, not a parameter — leaking it makes inference believe
	// the handler reads a context field it never touches.
	it('not leak an identifier inside a default value as a parameter', () => {
		const parameter = '({ a = f({ x: 1 }, body, 2), c })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, c: true },
			hasParenthesis: true
		})
	})

	it('not leak the tail of a template literal default', () => {
		const parameter = '({ a = `${x}`, body })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, body: true },
			hasParenthesis: true
		})
	})

	it('not leak the tail of an arrow function default', () => {
		const parameter = '({ a = (x) => ({ y: 1 }), b })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, b: true },
			hasParenthesis: true
		})
	})

	it('not leak the tail of an array default holding an object', () => {
		const parameter = '({ a = [1, {x:1}], b })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, b: true },
			hasParenthesis: true
		})
	})

	// A `}` inside a default's string closes the pattern early if the default
	// is still present when the outer brackets are matched, dropping every
	// parameter after it.
	it('not drop parameters after a closing brace inside a string default', () => {
		const parameter = "({ a = '}', body })"
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, body: true },
			hasParenthesis: true
		})
	})

	it('not drop parameters after a closing brace inside a regex default', () => {
		const parameter = '({ a = /}/, body })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, body: true },
			hasParenthesis: true
		})
	})

	// A nested pattern that carries its own default: the default has to go
	// first, or the leftover `= { b: 1 }` registers as an empty parameter.
	it('not leak an empty parameter from a defaulted nested pattern', () => {
		const parameter = '({ a: { b } = { b: 1 }, query })'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			parameters: { a: true, query: true },
			hasParenthesis: true
		})
	})

	it('handle last parameter destructuring', () => {
		const parameter = '{ set, cookie: { auth } }'
		const result = retrieveRootparameters(parameter)
		expect(result).toEqual({
			hasParenthesis: true,
			parameters: { set: true, cookie: true }
		})
	})

	// A `key: alias` sitting in the chunk BEFORE a nested pattern used to be
	// pushed raw, yielding the parameter name `onHandle:h`. That name never
	// matches trace's phase getter, so the phase was silently uninstrumented.
	it('strip a colon alias that precedes a nested pattern', () => {
		const result = retrieveRootparameters('({ a: x, b: { c } })')
		expect(result).toEqual({
			hasParenthesis: true,
			parameters: { a: true, b: true }
		})
	})

	it('strip every colon alias preceding a nested pattern', () => {
		const result = retrieveRootparameters(
			'({ query: q, params: { id }, body })'
		)
		expect(result).toEqual({
			hasParenthesis: true,
			parameters: { query: true, params: true, body: true }
		})
	})
})
