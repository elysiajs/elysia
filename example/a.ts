import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => {
		throw new Error('Ai')

		return 'a'
	})
	.listen(3000)
