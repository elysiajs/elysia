import { expect, it } from 'bun:test'

import { parse } from '../../src/cookie/lib'
import { compileCookieConfig } from '../../src/cookie/config'
import {
	parseCookieRaw,
	parseCookieRawDeferred,
	parseCookieRawLazy,
	parseCookieRawSigned,
	parseCookieRawSync
} from '../../src/cookie/utils'

it('rejects unsafe names without changing duplicate, empty, or quoted values', () => {
	const parsed = parse(
		'__proto__=bad; first=one; first=two; constructor=bad; bare; spaced = two\t; empty=; quoted="a"; prototype=bad'
	)
	expect(Object.getPrototypeOf(parsed)).toBeNull()
	expect({ ...parsed }).toEqual({
		first: 'one',
		spaced: 'two',
		empty: '',
		quoted: '"a"'
	})
})

it('keeps decoding and request isolation across raw cookie paths', async () => {
	const config = compileCookieConfig(undefined, undefined)
	for (const read of [
		parseCookieRaw,
		parseCookieRawLazy,
		parseCookieRawSigned,
		parseCookieRawSync,
		parseCookieRawDeferred
	]) {
		const header = 'data=%7B%22ok%22%3Atrue%7D; bad=%E0%A4%A; __proto__=bad'
		const first = await read(header, config)
		const second = await read(header, config)
		expect(first).not.toBe(second)
		expect(Object.getPrototypeOf(first)).toBeNull()
		expect(Object.keys(first)).toEqual(['data', 'bad'])
		expect(first.bad).toBe('%E0%A4%A')
		expect(first.data).toEqual(
			read === parseCookieRawDeferred ? '%7B%22ok%22%3Atrue%7D' : { ok: true }
		)
		first.data = 'changed'
		expect(second.data).not.toBe('changed')
		const empty = await read('', config)
		empty.session = 'changed'
		expect(Object.keys(await read('', config))).toEqual([])
	}
})
