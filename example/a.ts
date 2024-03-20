import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const subPlugin = new Elysia().derive({ as: 'scoped' }, () => {
	return {
		hi: '1'
	}
})

const plugin = new Elysia().use(subPlugin).propagate()

const app = new Elysia().use(plugin).get('/', ({ hi }) => hi)

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
