import { Elysia } from '../src/2'

const app = new Elysia()
	.macro({
		a: {
			beforeHandle({ query }) {
				console.log({ query })
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

app.handle('/?name=a').then((res) =>
	res.text().then((text) => console.log(text))
)

app.listen(3000)

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
