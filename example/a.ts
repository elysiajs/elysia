import { Elysia, t } from '../src/2'

const app = new Elysia()
	.macro({
		a: {
			body: t.String(),
			beforeHandle: function a() {
				console.log('a')

				return { q: 'q' }
			}
		},
		b: {
			body: t.Number(),
			beforeHandle: function b() {
				console.log('b')
			}
		}
	})
	.guard({
		a: true,
		beforeHandle: function a1({ q }) {
			console.log('a1')
		}
	})
	.get('/a', () => 'ok')
	.guard({
		b: true,
		beforeHandle: function b1() {
			console.log('b1')
		}
	})
	.get('/b', () => 'ok')

// console.log(app.routes)

// await app.handle('/a').then((res) => res.text().then((text) => console.log(text)))
await app.handle('/b')

// console.log(app.routes)

// app.listen(3000)

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
