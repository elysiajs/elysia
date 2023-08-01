import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ set }) => {
		set.headers['Hello'] = 'World'

		return 'a'
	}, {
		afterHandle() {
			return null
		}
	})
	.listen(3000)
