import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import * as TBValue from 'typebox/value'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import { Compiled } from '../../src/compile/aot'
import { req } from '../utils'

const encodeSpy = spyOn(TBValue, 'Encode')

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	encodeSpy.mockClear()
})

const codecSchema = () => t.Object({ when: t.Date(), n: t.Number() })
const value = () => ({ when: new Date('2020-01-01T00:00:00.000Z'), n: 1 })
const encoded = { when: '2020-01-01T00:00:00.000Z', n: 1 }

describe('encode-mirror fallback guard (CYCLE 5)', () => {
	it('a slot-less validator DOES hit the interpreted Encode (sanity)', () => {
		const v = new (TypeBoxValidator as any)(codecSchema())
		encodeSpy.mockClear()
		expect(v.EncodeFrom(value(), 'response')).toEqual(encoded)
		expect(encodeSpy).toHaveBeenCalled()
	})

	it('a default-config codec response route encodes via the mirror, not Encode', async () => {
		const app = new Elysia().get(
			'/codec',
			{ response: codecSchema() },
			() => value()
		)

		// first request compiles + encodes; mirror setup uses createMirror, never Encode
		encodeSpy.mockClear()
		const res = await app.handle(req('/codec'))

		expect(await res.json()).toEqual(encoded)
		expect(encodeSpy).not.toHaveBeenCalled()
	})

	it('stays on the mirror across warmed requests', async () => {
		const app = new Elysia().get(
			'/codec',
			{ response: codecSchema() },
			() => value()
		)

		await app.handle(req('/codec'))
		encodeSpy.mockClear()
		await app.handle(req('/codec'))
		await app.handle(req('/codec'))

		expect(encodeSpy).not.toHaveBeenCalled()
	})
})
