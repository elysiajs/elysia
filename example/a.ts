import { Elysia, t } from '../src'

const a = new Elysia()
	.decorate('decorate', 'decorate')
	.state('state', 'state')
	.model('model', t.String())
	.error('error', Error)

const app = new Elysia().use(a).prefix('decorator', 'p').prefix('error', 'p')
// .get(['/', '/b'], () => {})
// .post('/', ({ A, body: { file } }) => file.size, {
// 	body: t.Object({
// 		file: t.File()
// 	})
// })
