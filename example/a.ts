import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.wrap((fn, request) => {
		const _request = request.clone()

		return () => {
			try {
				return fn(request.clone())
			} catch {
				console.log('ER')
			}
		}
	})
	.onError(({ error }) => {
		if (error) throw error
	})
	.get('/', () => {
		throw new Error('A')

		return 'Hello World!'
	})
	.listen(3000)

// console.log(app.fetch.toString())

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
