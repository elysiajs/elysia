import { Elysia } from '../../src'
import { baseElysia, setup } from './main'

export const usersHandler = new Elysia()
    .use(setup)
	.get('/users', ({ store: { count } }) => {
		return `${count} users`
	})
