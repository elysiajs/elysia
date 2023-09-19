import { describe, expect, it } from 'bun:test'

import { mergeDeep } from '../../src'

describe('mergeDeep', () => {
	it('merge empty object', () => {
		const result = mergeDeep({}, {})
		expect(result).toEqual({})
	})

	it('merge non-overlapping key', () => {
		const result = mergeDeep({ key1: 'value1' }, { key2: 'value2' })

		expect(result).toEqual({ key1: 'value1', key2: 'value2' })
	})

	it('merge overlapping key', () => {
		const result = mergeDeep(
			{
				name: 'Eula',
				city: 'Mondstadt'
			},
			{
				name: 'Amber',
				affiliation: 'Knight'
			}
		)

		expect(result).toEqual({
			name: 'Amber',
			city: 'Mondstadt',
			affiliation: 'Knight'
		})
	})

	it('Maintain overlapping class', () => {
		class Test {
			readonly name = 'test'

			public foo() {
				return this.name
			}
		}

		const target = { key1: Test }
		const source = { key1: Test }

		const result = mergeDeep(target, source)
		expect(result.key1).toBe(Test)
	})
})
