import { Elysia, t } from '../src'

const app = new Elysia()
	.derive(({ cookie: { test } }) => {
		if (!test.value) {
			test.value = 'Hello, world!'
		}

		return {}
	})
	.get('/', () => 'Hello, world!')

app.handle(
	new Request('http://localhost:3000/', {
		headers: {
			cookie: 'test=Hello, world!'
		}
	})
)
	.then((x) => x.headers)
	.then(console.log)
