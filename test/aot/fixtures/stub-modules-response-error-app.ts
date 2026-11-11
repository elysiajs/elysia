import { Elysia, t } from '../../../src'

// The route's own error hook writes `set.cookie` on a thrown error
export const app = new Elysia().get(
	'/',
	{
		response: t.String({ minLength: 1 }),
		error({ set }) {
			set.cookie = { seen: { value: '1' } }
			return 'handled'
		}
	},
	() => {
		throw new Error('boom')
	}
)
