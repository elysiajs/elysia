import { Elysia } from '../../src'
import { usersHandler } from './handler'

export const setup = new Elysia({ name: 'setup' })
    .state('count', 0)

// main.ts
export const baseElysia = new Elysia()
	.use(setup)
	.use(usersHandler)
	.get('/main', ({ store: { count } }) => {
		return `${count} users`
	})
	.listen(8000)
