import { Elysia, status, t } from '../src'
import { delay, req } from '../test/utils'

const a = new Elysia()
	.macro({
		a: {
			resolve: () => ({ a: 'a' })
		}
	})
	.post('/', ({ a }) => {}, {
		a: true
	})
