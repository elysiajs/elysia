import { Elysia } from '../../../src/base'

// Standard Schema only: nothing is captured, so a lazy manifest has no group
const body = {
	'~standard': {
		version: 1,
		vendor: 'probe',
		validate: (value: any) =>
			value?.name === 'elysia'
				? { value }
				: { issues: [{ message: 'name must be elysia' }] }
	}
}

export const app = new Elysia().post('/u', { body } as any, ({ body }) => body)
