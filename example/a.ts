import { Elysia, status, t } from '../src'
import { delay, req } from '../test/utils'

const a = new Elysia()
	.macro({
		a: {
			resolve: () => ({ a: 'a' })
		}
	})
	.post('/', (c) => {}, {
		a: true
	})
