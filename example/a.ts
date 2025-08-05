import { Elysia, t } from '../src'
import { req } from '../test/utils'

class CustomError {
	constructor(public value: string) { }
}

const app = new Elysia()
	.onAfterResponse(() => {
		console.log("THING")
	})
	.post('/', () => 'yay', {
		body: t.Object({
			test: t.String()
		})
	})
	.get('/customError', () => {
		throw new CustomError('whelp')
	})

app.handle(req('/customError'))
