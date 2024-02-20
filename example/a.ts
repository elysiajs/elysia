import { Elysia } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.trace(async ({ handle, set }) => {
		const { time, skip, end } = await handle

		set.headers.time = ((await end) - time).toString()
		set.headers.skip = `${skip}`
	})

console.log(app.inference)

	app.get('/', async () => {
		return 'a'
	})

const { headers } = await app.handle(req('/'))

// expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// expect(headers.get('skip')).toBe('false')
// const res = await app
// 	.handle(
// 		post('/json', {
// 			username: 'saltyaom',
// 			password: '12345678'
// 		})
// 	)
// 	.then((t) => t.text())

// console.log({ res })

// const res = await app.handle(req('/')).then((t) => t.text())
// const res2 = await app.handle(req('/h2')).then((t) => t.text())

// console.log(res)
