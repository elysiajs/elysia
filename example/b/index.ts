// setup.ts

import { Elysia } from '../../src'

// database.ts

export const databasePlugin = new Elysia({
	name: 'database',
	seed: 'database'
}).decorate('database', 'a')

// authentication-plugin.ts

export const authenticationPlugin = new Elysia({
	name: 'authentication',
	seed: 'authentication'
})
	.use(databasePlugin)
	.derive(async ({ headers, database }) => {
		// logic
	})

// setup
export const setup = new Elysia({ name: 'setup', seed: 'setup' }).use(
	authenticationPlugin
)

// register.ts

export const register = new Elysia({ prefix: '/register' })
	.use(setup)
	.get('/', async ({ body, set, database }) => {
		// logic
	})
// login.ts

export const login = new Elysia({ prefix: '/login' })
	.use(setup)
	.get('/', async ({ body, set, database }) => {
		// logic
	})
// authentication.ts
export const authenticationRoute = new Elysia({ prefix: '/authentication' })
	.use(login)
	.use(register)

export const routes = new Elysia().use(authenticationRoute)

export const v2 = new Elysia({ prefix: '/v2' }).use(routes)

const app = new Elysia()
	// .use(cors())
	// .use(bearer())
	.use(v2)
	.listen(8080)
