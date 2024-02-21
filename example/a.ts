import { Elysia, error } from '../src'
import { post, req } from '../test/utils'

let called = 0

const a = new Elysia().macro(({ onBeforeHandle }) => ({
	requiredUser(value: boolean) {
		onBeforeHandle(async () => {
			called++

			return error(401, {
				code: 'S000002',
				message: 'Unauthorized'
			})
		})
	}
}))

const app = new Elysia().use(a).use(a).get('/', () => 'a', {
	'requiredUser': true
})

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)

console.log(called)

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
