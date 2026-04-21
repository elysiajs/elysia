import { Elysia, t } from '../src/2'

const app = new Elysia()
	// .onError(() => {
	// 	return 'QQA'
	// })
	.get('/', () => {
		throw new Error('Q')
	})
	.listen(3000)

app.handle('http://localhost').then((res) =>
	res.text().then((text) => console.log(text))
)
