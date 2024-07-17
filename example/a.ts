import { Elysia } from '../src'
import { req } from '../test/utils'

export const logger = new Elysia({ name: 'logger' }).derive(
	{ as: 'global' },
	() => ({
		logger: {
			log(msg: string) {
				console.log(msg)
			}
		}
	})
)

export const error = new Elysia({ name: 'error' })
	.use(logger)
	.error({
		Error
	})
	.onError({ as: 'global' }, (ctx) => {
		ctx.logger?.log(ctx.code)
	})

new Elysia()
	.use(error)
	.get('/', () => {
		throw new Error('whelp')
	})
	.listen(8080)
