import { Elysia, t } from '../src'

export const app = new Elysia()
	.get('', () => 'Level 2')
	.get(
		'/:id',
		({ params: { id } }) => `You are in the identified route! ${id}`
	)

type Res = typeof app._routes
