import { Elysia, t, ValidationError } from '../src'
import { post, req } from '../test/utils'

let err: Error | undefined

const app = new Elysia()
	.post('/', ({ body }) => body, {
		headers: t.Object({
			year: t.Numeric({ minimum: 1900, maximum: 2160 })
		}),
		transform({ headers }) {
			console.log(headers)
		},
		error({ code, error }) {
			console.log(code)
			switch (code) {
				case 'VALIDATION':
					err = error
			}
		}
	})
	.listen(3000)

await app.handle(
	req('/', {
		headers: {
			year: '3000'
		}
	})
)
