import { describe, expect, it } from 'bun:test'
import { parseSetCookies } from '../../../src/adapter/utils'

describe('Web Standard - Parse Set Cookie', () => {
	it('should handle empty arrays', () => {
		const headers = new Headers([])
		const setCookie: string[] = []
		const result = parseSetCookies(headers, setCookie)
		expect(result).toEqual(headers)
	})

	it('should handle a setCookie array with one element containing a single key-value pair', () => {
		const headers = new Headers([])
		const setCookie = ['key=value']
		const result = parseSetCookies(headers, setCookie)
		expect(result.get('Set-Cookie')).toEqual('key=value')
	})

	it('should handle a setCookie array with multiple elements, each containing a single key-value pair', () => {
		const headers = new Headers([])
		const setCookie = ['key1=value1', 'key2=value2']
		const result = parseSetCookies(headers, setCookie)
		expect(result.get('Set-Cookie')).toEqual('key1=value1, key2=value2')
	})

	it('should handle a setCookie array with one element containing multiple key-value pairs', () => {
		const headers = new Headers([])
		const setCookie = ['key1=value1; key2=value2']
		const result = parseSetCookies(headers, setCookie)
		expect(result.get('Set-Cookie')).toEqual('key1=value1; key2=value2')
	})

	it('should handle a setCookie array with multiple elements, each containing multiple key-value pairs', () => {
		const headers = new Headers([])
		const setCookie = [
			'key1=value1; key2=value2',
			'key3=value3; key4=value4'
		]
		const result = parseSetCookies(headers, setCookie)
		expect(result.get('Set-Cookie')).toEqual(
			'key1=value1; key2=value2, key3=value3; key4=value4'
		)
	})

	it('should handle null values', () => {
		const headers = null
		const setCookie = null
		// @ts-ignore
		const result = parseSetCookies(headers, setCookie)
		expect(result).toBeNull()
	})
})
