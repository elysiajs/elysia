import { afterEach, describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { Validator } from '../../src/validator'

describe('MultiValidator array merging', () => {
	afterEach(() => {
		Validator.clear()
	})

	it('concatenates member results in schema order', () => {
		const mergeSchema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => ({ value: ['FROM_MERGE'] })
			}
		}

		const mv: any = Validator.create(t.Array(t.String()), {
			schemas: [mergeSchema as any]
		})

		expect(mv.constructor.name).toBe('MultiValidator')

		const out = mv.From(['a', 'b', 'c'], 'body') as unknown[]

		expect(out).toEqual(['a', 'b', 'c', 'FROM_MERGE'])
		expect(out.length).toBe(4)
	})
})
