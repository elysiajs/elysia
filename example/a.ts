import { Elysia, t } from '../src'

class CustomError extends Error {
	constructor(public message: string) {
		super(message)
	}
}

const app = new Elysia()
	.addError({
		Code1: CustomError,
		Code2: CustomError
	})
	.onError(({ code, error }) => {
		switch (code) {
			case 'Code1':
				return error

			case 'Code2':
				return error
		}
	})
	.get('/', () => {
		throw new CustomError('Server is during maintainance')

		return 'unreachable'
	})
	.listen(3000)
