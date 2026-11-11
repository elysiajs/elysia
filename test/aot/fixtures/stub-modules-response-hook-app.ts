import { Elysia, t } from '../../../src'

// A route hook, not the handler, writes `set.cookie`
export const app = new Elysia().get(
	'/',
	{
		response: t.String({ minLength: 1 }),
		afterHandle({ set }) {
			set.cookie = { seen: { value: '1' } }
		}
	},
	() => 'ok'
)
