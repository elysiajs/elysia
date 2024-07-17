import { describe, it, expect } from 'bun:test'
import { retrieveRootParamters } from '../../src/sucrose'

describe('retrieve root parameter', () => {
	it('return an empty string when given an empty string', () => {
		const parameter = ''
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: [],
			hasParenthesis: false
		})
	})

	// Doesn't make sense as JavaScript will panic
	// it('return the same string when there are no brackets in the string', () => {
	// 	const parameter = 'hello world'
	// 	const result = retrieveRootParamters(parameter)
	// 	expect(result).toEqual({
	// 		parameters: ['hello world'],
	// 		hasParenthesis: false
	// 	})
	// })

	it('remove brackets and their contents when they are at the root level', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: ['hello', 'elysia'],
			hasParenthesis: true
		})
	})

	it('return an empty string when given only brackets', () => {
		const parameter = '()'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: [],
			hasParenthesis: false
		})
	})

	it('return an empty string when given only one bracket', () => {
		const parameter = '('
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: [],
			hasParenthesis: false
		})
	})

	// Doesn't make sense as JavaScript will panic
	// it('return even if bracket is unbalanced', () => {
	// 	const parameter = '({ hello: { world: { a } })'
	// 	const result = retrieveRootParamters(parameter)
	// 	expect(result).toEqual({
	// 		parameters: ['hello'],
	// 		hasParenthesis: true
	// 	})
	// })

	it('return the root parameters when given a string with spaces between brackets', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: ['hello', 'elysia'],
			hasParenthesis: true
		})
	})

	it('return parameter on minified bracket', () => {
		const parameter = '({ hello, path })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: ['hello', 'path'],
			hasParenthesis: true
		})
	})

	it('handle tab and new line', () => {
		const parameter = '({ hello: { world: { a } }, \nelysia, \teden })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual({
			parameters: ['hello', 'elysia', 'eden'],
			hasParenthesis: true
		})
	})
})
