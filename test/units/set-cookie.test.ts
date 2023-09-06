import { describe, it, expect } from 'bun:test'
import { parseSetCookies } from '../../src/handler'

describe('Parse Set Cookie', () => {
	it('Append single cookie', () => {
		const headers = new Headers()
		const setCookie = {
			name: 'noa'
		}

		const result = parseSetCookies(headers, setCookie)

		expect(result.get('Set-Cookie')).toBe('name=noa')
	})

	it('Append multiple cookie', () => {
		const headers = new Headers()
		const setCookie = {
			name: 'noa',
			affiliation: 'seminar'
		}

		const result = parseSetCookies(headers, setCookie)

		expect(result.get('Set-Cookie')).toBe('name=noa, affiliation=seminar')
	})

	it('Append multiple value cookie', () => {
		const headers = new Headers()
		const setCookie = {
			name: ['noa', 'yuuka']
		}

		const result = parseSetCookies(headers, setCookie)

		expect(result.get('Set-Cookie')).toBe('name=noa, name=yuuka')
	})
})
