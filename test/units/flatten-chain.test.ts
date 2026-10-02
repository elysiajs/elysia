import { describe, expect, it } from 'bun:test'

import { flattenChain, type ChainNode } from '../../src/utils'

describe('flattenChain schema fields', () => {
	it('keeps the current schema marker as a scalar value', () => {
		const parent: ChainNode = {
			added: { schema: 'override' as any },
			parent: undefined
		}
		const child: ChainNode = {
			added: { schema: 'merge' as any },
			parent
		}

		const flat = flattenChain(child) as any

		expect(Array.isArray(flat.schema)).toBe(false)
		expect(flat.schema).toBe('merge')
	})

	it('accumulates schemas from each chain node', () => {
		const schemaA = { body: { type: 'string' } }
		const schemaB = { query: { type: 'string' } }
		const parent: ChainNode = {
			added: { schemas: [schemaA] as any },
			parent: undefined
		}
		const child: ChainNode = {
			added: { schemas: [schemaB] as any },
			parent
		}

		const flat = flattenChain(child) as any

		expect(Array.isArray(flat.schemas)).toBe(true)
		expect(flat.schemas).toHaveLength(2)
	})
})
