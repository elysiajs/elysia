import { Elysia } from '../src'

export interface AuthData {
	id: number
}

const app = new Elysia()
	.derive(({ request }) => {
		const apiKey = request.headers.get('x-api-key')
		if (!apiKey) return { auth: null }

		return { auth: { id: 1 } satisfies AuthData }
	})
	.onBeforeHandle(({ auth, set }) => {
		console.log(auth?.id)
		console.log(set.status)
	})

app['~Volatile']
