import { Elysia } from '../src/2'

const app = new Elysia()
	.macro({
		a: {
			beforeHandle() {
				console.log('a')
			}
		},
		b: {
			beforeHandle() {
				console.log('b')
			}
		}
	})
	.guard({
		a: true,
		beforeHandle() {
			console.log('a1')
		}
	})
	.get('/a', () => 'ok')
	.guard({
		b: true,
		beforeHandle() {
			console.log('b1')
		}
	})
	.get('/b', () => 'ok')

// await app.handle('/a').then((res) => res.text().then((text) => console.log(text)))
await app.handle('/b')

console.log(app.routes)

// app.listen(3000)

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
