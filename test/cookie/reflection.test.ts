import { describe, expect, it } from 'bun:test'

import { compileCookieConfig } from '../../src/cookie/config'
import { buildCookieJar } from '../../src/cookie/utils'

const config = compileCookieConfig(undefined, {})

describe('cookie jar reflection', () => {
	it('keeps internal state hidden and preserves raw key order after access', () => {
		const jar = buildCookieJar(
			{ headers: {} },
			{ first: 'a', second: 'b' },
			config
		)

		expect(Object.getOwnPropertySymbols(jar)).toEqual([])
		expect(Reflect.ownKeys(jar)).toEqual(['first', 'second'])

		expect(jar.first.value).toBe('a')
		expect(Object.keys(jar)).toEqual(['first', 'second'])
		expect(Reflect.ownKeys(jar)).toEqual(['first', 'second'])
	})

	it('preserves reflection when made non-extensible before pending entries are read', () => {
		const jar = buildCookieJar(
			{ headers: {} },
			{ first: 'a', second: 'b' },
			config
		)

		Object.preventExtensions(jar)

		expect(Object.isExtensible(jar)).toBe(false)
		expect(Reflect.ownKeys(jar)).toEqual(['first', 'second'])
		expect(jar.first).toBe(jar.first)
		expect(jar.first.value).toBe('a')
	})

	it('keeps dangerous pending names on the null-prototype jar', () => {
		const raw = Object.create(null)
		for (const name of ['__proto__', 'constructor', 'prototype'])
			Object.defineProperty(raw, name, {
				configurable: true,
				enumerable: true,
				value: name,
				writable: true
			})

		const jar = buildCookieJar({ headers: {} }, raw, config)

		expect(Object.keys(jar)).toEqual([
			'__proto__',
			'constructor',
			'prototype'
		])
		expect(jar.__proto__.value).toBe('__proto__')
		expect(jar.constructor.value).toBe('constructor')
		expect(jar.prototype.value).toBe('prototype')
		expect((Object.prototype as any).value).toBeUndefined()
	})

	it('preserves large materialized key order with symbols and changes', () => {
		const names = Array.from({ length: 1_024 }, (_, index) => `c${index}`)
		const raw = Object.fromEntries(names.map((name) => [name, name]))
		const jar = buildCookieJar({ headers: {} }, raw, config)

		for (const name of names) expect(jar[name].value).toBe(name)

		const marker = Symbol('marker')
		Object.defineProperty(jar, marker, {
			configurable: true,
			enumerable: true,
			value: true
		})
		delete jar.c17
		Object.defineProperty(jar, 'later', {
			configurable: true,
			enumerable: true,
			value: { value: 'later' },
			writable: true
		})

		const expected = [...names.slice(0, 17), ...names.slice(18), 'later']
		expect(Object.keys(jar)).toEqual(expected)
		expect(Reflect.ownKeys(jar)).toEqual([...expected, marker])

		Object.preventExtensions(jar)
		expect(Reflect.ownKeys(jar)).toEqual([...expected, marker])
	})
})
