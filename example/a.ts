import { Elysia, t } from '../src'
import { req } from '../test/utils'

class APIError extends Error {
	public readonly message: string
	public readonly status: number

	constructor(status: number, message: string, options?: ErrorOptions) {
		super(message, options)

		this.status = status
		this.message = message
		this.name = 'APIError'

		Object.setPrototypeOf(this, APIError.prototype)
		Error.captureStackTrace(this)
	}
}

const errors = new Elysia()
	.error({ APIError })
	.onError({ as: 'global' }, ({ error, request, set, code }) => {
		console.log(code)
	})

const requestHandler = new Elysia()
	.onTransform((context) => {
		throw new APIError(403, 'Not authorized')
	})
	.get('/', () => 'a')

const app = new Elysia().use(errors).use(requestHandler).compile()

// console.log(app.fetch.toString())

app.handle(req('/'))
