import { Elysia, t } from '../src'

class SomeCustomError extends Error {
	asJSON() {
		return JSON.stringify({
			somePretty: 'json'
		})
	}
}

const app = new Elysia()
	.onError(({ error }) => {
		if (error instanceof SomeCustomError)
			return error.asJSON()
	})
	.onRequest(() => {
		throw new SomeCustomError()
	})
	.get('/', () => '')

const res = await app.handle(new Request('https://localhost/'))
const body = await res.json()
