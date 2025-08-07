// index.ts
import Elysia from '../src'

const app = new Elysia()
	.onError((err) => {
		if (err.code === 'NOT_FOUND') return

		process.stdout.write(`Error: ${JSON.stringify(err, null, 2)}\n`)
	})
	.get('/testing-status', ({ status }) => {
		return status(403, 'This is a test error from status')
	})
	.resolve(({ status }) => {
		return status(403, 'This is a test error from resolve')
	})
	.get('/testing-resolve', () => 'Hello World!')
	.listen(3000)

console.log(app.routes[1].compile().toString())
