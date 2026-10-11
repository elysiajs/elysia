import { Elysia, HTTPError, t } from '../src'

class CustomError extends HTTPError.id('NAME', 418) {}

new Elysia()
	.onError('global', CustomError, () => ({
		Phoebe: 'Chupi'
	}))
	.get('/', () => new CustomError())
	.listen(3000)
