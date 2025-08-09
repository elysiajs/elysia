import { Elysia, t } from '../src'

export const app = new Elysia().get(
	'/test1',
	() => {
		return { message: 'Hello, World!' }
	},
	{
		afterHandle: ({ response }) => {
			console.log(response)
		}
	}
)
