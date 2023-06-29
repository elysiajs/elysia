import { Elysia, t } from '../src'

const res = new Elysia({
	aot: false
})
	.get('/', () => 'Hi')
	.onError(({ code }) => {
		if (code === 'NOT_FOUND')
			return new Response("I'm a teapot", {
				status: 418
			})
	})
	.listen(3000)

console.log('Running a.ts')
