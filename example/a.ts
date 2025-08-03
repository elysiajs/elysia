import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.mapResponse(({ response }) => {
		console.log({ response })
	})
	.onError(({ code }) => {
		if (code === 'VALIDATION') return 'b'
	})
	.get('/query', () => 'a', {
		query: t.Object({
			a: t.String()
		})
	})
	.listen(3000)

app.handle(req('/query'))
	.then((x) => x.text())
	.then(console.log)
