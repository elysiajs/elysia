import { Elysia, t } from '../src'

class CustomError extends Error {
	constructor(public message: string) {
		super(message)
	}
}

const setup = new Elysia({
	name: 'setup'
})
	.decorate('A', 'A')
	.state('B', 'B')
	.model('string', t.String())
	.addError('CUSTOM_ERROR_0', CustomError)
	.addError({
		CUSTOM_ERROR_1: CustomError,
		CUSTOM_ERROR_2: CustomError
	})

const a = new Elysia({ prefix: '/hello' })
	.use(setup)
	.post('/', ({ A, store: { B } }) => 'Hello', {
		body: 'string'
	})
	.onError(({ code, error }) => {
		switch (code) {
			case 'CUSTOM_ERROR_0':
				return error
		}
	})
