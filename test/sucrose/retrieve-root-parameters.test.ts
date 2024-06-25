import { describe, it, expect } from 'bun:test'
import { retrieveRootParamters } from '../../src/sucrose'

describe('retrieve root parameter', () => {
	it('return an empty string when given an empty string', () => {
		const parameter = ''
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('')
	})

	it('return the same string when there are no brackets in the string', () => {
		const parameter = 'hello world'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('hello world')
	})

	it('remove brackets and their contents when they are at the root level', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello elysia }')
	})

	it('return an empty string when given only brackets', () => {
		const parameter = '()'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('')
	})

	it('return an empty string when given only one bracket', () => {
		const parameter = '('
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('')
	})

	it('return even if bracket is unbalanced', () => {
		const parameter = '({ hello: { world: { a } })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello }')
	})

	it('return the root parameters when given a string with spaces between brackets', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello elysia }')
	})

	it('return the root parameters when given a string with spaces between brackets and curly braces', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello elysia }')
	})

	it('return the root parameters when given a string with spaces between brackets and parentheses', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello elysia }')
	})

	it('return the root parameters when given a string with spaces between brackets, curly braces, and parentheses', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello elysia }')
	})

	it('return the root parameters when given a string with spaces between brackets, curly braces, parentheses, and other characters', () => {
		const parameter = '({ hello: { world: { a } }, elysia })'
		const result = retrieveRootParamters(parameter)
		expect(result).toEqual('{ hello elysia }')
	})
})
