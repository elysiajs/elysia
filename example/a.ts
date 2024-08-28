import { Elysia, t } from '../src'

export const userSchema = t.Object({
	a: t.Date()
})

const app = new Elysia().get(
	'/test',
	() => ({
		a: new Date()
	}),
	{
		response: userSchema,
		error({ error }) {
			console.log(error)
		}
	}
)

const response = await app.handle(
	new Request('http://localhost/test', {
		method: 'GET'
	})
)

console.log(response, await response.text())
