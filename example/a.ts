import { Elysia, t, error } from '../src'
import { req } from '../test/utils'

const res = await new Elysia({
	aot: false
})
	.get('/', () => 'Hi')
	.onError(({ code }) => {
		if (code === 'NOT_FOUND')
			return new Response("I'm a teapot", {
				status: 418
			})
	})
	.handle(req('/not-found'))

// console.log(await res.text())
// console.log(res.status)
