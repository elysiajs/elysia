import { Elysia } from '../src/2'
import { NotFound } from '../src/2/error'

const app = new Elysia()
	.macro({
		a: {
			beforeHandle() {
				console.log('object macro')
			}
		},
		b: () => ({
			beforeHandle() {
				console.log('function macro')
			}
		})
	})
	.guard({
		a: true
	})
	.get('/', () => 'ok', {
		beforeHandle() {
			console.log('Inline')
		},
		b: true
	})

app.handle('/').then((res) => res.text().then((text) => console.log(text)))

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
