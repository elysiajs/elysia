import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import * as TBValue from 'typebox/value'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import { Compiled } from '../../src/compile/aot'

const encodeSpy = spyOn(TBValue, 'Encode')

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	encodeSpy.mockClear()
})

const codecSchema = () => t.Object({ when: t.Date(), n: t.Number() })
const value = () => ({ when: new Date('2020-01-01T00:00:00.000Z'), n: 1 })
const encoded = { when: '2020-01-01T00:00:00.000Z', n: 1 }

describe('response encode mirror selection', () => {
	it('uses interpreted Encode when no response slot is provided', () => {
		const v = new (TypeBoxValidator as any)(codecSchema())
		encodeSpy.mockClear()
		expect(v.EncodeFrom(value(), 'response')).toEqual(encoded)
		expect(encodeSpy).toHaveBeenCalled()
	})

	it('uses the encode mirror for a codec response route', async () => {
		const app = new Elysia().get(
			'/codec',
			{ response: codecSchema() },
			() => value()
		)

		encodeSpy.mockClear()
		const res = await app.handle('/codec')

		await expect(res.json()).resolves.toEqual(encoded)
		expect(encodeSpy).not.toHaveBeenCalled()
	})

	it('continues using the mirror after the route is warm', async () => {
		const app = new Elysia().get(
			'/codec',
			{ response: codecSchema() },
			() => value()
		)

		await app.handle('/codec')
		encodeSpy.mockClear()
		await app.handle('/codec')
		await app.handle('/codec')

		expect(encodeSpy).not.toHaveBeenCalled()
	})
})
