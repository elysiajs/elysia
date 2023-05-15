import { Elysia } from '../src'

const app = new Elysia()
	.derive(({ query, headers: { authorization } }) => ({
		get bearer() {
			if (authorization?.startsWith('Bearer')) return 'hi'

			return 'hi'
		}
	}))
	.get('/', ({ bearer }) => bearer)
	.listen(3000)

const a = []
const b = () => {}
