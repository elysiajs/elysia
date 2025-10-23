import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({
	allowUnsafeValidationDetails: true
})
	.onError(({ error }) => {
		// console.log(error)
	})
	.get('/q', () => {}, {
		query: t.Object({
			a: t.String()
		})
	})
	.listen(3000)
