import { t } from '../../src'

import { describe, expect, it } from 'bun:test'

import { mergeObjectSchemas } from '../../src/schema'

describe('mergeDeep', () => {
	it('merge object', () => {
		const result = mergeObjectSchemas([
			t.Object({
				name: t.String()
			}),
			t.Object({
				age: t.Number()
			})
		])

		expect(result).toEqual({
			schema: t.Object({
				name: t.String(),
				age: t.Number()
			}),
			notObjects: []
		})
	})

	it('handle additionalProperties true', () => {
		const result = mergeObjectSchemas([
			t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: true
				}
			),
			t.Object({
				age: t.Number()
			})
		])

		expect(result).toEqual({
			schema: t.Object(
				{
					name: t.String(),
					age: t.Number()
				},
				{
					additionalProperties: true
				}
			),
			notObjects: []
		})
	})

	it('handle additionalProperties false', () => {
		const result = mergeObjectSchemas([
			t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: false
				}
			),
			t.Object({
				age: t.Number()
			})
		])

		expect(result).toEqual({
			schema: t.Object(
				{
					name: t.String(),
					age: t.Number()
				},
				{
					additionalProperties: false
				}
			),
			notObjects: []
		})
	})

	it('prefers additionalProperties: false over true', () => {
		const result = mergeObjectSchemas([
			t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: true
				}
			),
			t.Object(
				{
					age: t.Number()
				},
				{
					additionalProperties: false
				}
			)
		])

		expect(result).toEqual({
			schema: t.Object(
				{
					name: t.String(),
					age: t.Number()
				},
				{
					additionalProperties: false
				}
			),
			notObjects: []
		})
	})

	it('handle non object', () => {
		const result = mergeObjectSchemas([
			t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: false
				}
			),
			t.Object({
				age: t.Number()
			}),
			t.String()
		])

		expect(result).toEqual({
			schema: t.Object(
				{
					name: t.String(),
					age: t.Number()
				},
				{
					additionalProperties: false
				}
			),
			notObjects: [t.String()]
		})
	})

	it('handle single object schema', () => {
		const result = mergeObjectSchemas([
			t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: false
				}
			)
		])

		expect(result).toEqual({
			schema: t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: false
				}
			),
			notObjects: []
		})
	})

	it('handle single non object schema', () => {
		const result = mergeObjectSchemas([t.String()])

		expect(result).toEqual({
			schema: undefined,
			notObjects: [t.String()]
		})
	})

	it('handle multiple object schemas', () => {
		const result = mergeObjectSchemas([
			t.Object(
				{
					name: t.String()
				},
				{
					additionalProperties: false
				}
			),
			t.Object({
				age: t.Number()
			}),
			t.Object({
				email: t.String()
			}),
			t.Object({
				address: t.String()
			})
		])

		expect(result).toEqual({
			schema: t.Object(
				{
					name: t.String(),
					age: t.Number(),
					email: t.String(),
					address: t.String()
				},
				{
					additionalProperties: false
				}
			),
			notObjects: []
		})
	})
})
