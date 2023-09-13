import { Elysia, t } from '../src'

const app = new Elysia()
	.decorate('A', 'B')
	.onError((context) => {

	})
	.get(['/', '/b'], () => {})
	.post('/', ({ A, body: { file } }) => file.size, {
		body: t.Object({
			file: t.File()
		})
	})
	.listen(3000)
