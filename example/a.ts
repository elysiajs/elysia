import { Elysia, t } from '../src'
import { Validator } from '../src/validator'

const plugin = new Elysia()
	.guard('plugin', {
		schema: 'standalone',
		afterHandle() {

		}
	})

const app = new Elysia()
	.use(plugin)
	.error(() => {
		console.log('main')

		return 'main'
	})
	.get('/main', () => {
		throw new Error('b')
	})

app.handle('/sub')
	.then((x) => x.text())
	.then((res) => console.log('res:', res))
