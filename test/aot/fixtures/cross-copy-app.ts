import { Elysia } from '../../../src/base'

// the build captures with TypeBox, the child serves on a cold bridge: only
// then does a request reach the replayed frozen validator
if (process.env.ELYSIA_AOT_BUILD) await import('../../../src')

const body = {
	'~kind': 'Object',
	type: 'object',
	properties: { name: { '~kind': 'String', type: 'string' } },
	required: ['name']
} as any

export const app = new Elysia().post('/u', { body }, ({ body }) => body)
