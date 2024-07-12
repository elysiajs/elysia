import { Elysia, t } from '../src'

const a = new Elysia().get('/error', ({ cookie: { a } }) => {
	a.value = null

	return 'ok'
})

a.handle(new Request('http://localhost/error'))
	.then((x) => x.headers.toJSON())
	.then(console.log)

// const api = treaty(a)

// const { data, error, response } = await api.error.get()

// console.log(data, error, response)
