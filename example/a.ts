import { Elysia, t } from '../src'

const a = new Elysia({ name: 'a', seed: 'awdawd' }).extends(
	({ onBeforeHandle }) => ({
		a(fn: () => void) {
			onBeforeHandle(fn)
		}
	})
)
const b = new Elysia({ name: 'b', seed: 'add' }).use(a).decorate('b', 'b')

const app = new Elysia()
	.use(a)
	.use(b)
	.get('/', () => 'Hello World', {
		a() {
			console.log('a')
		}
	})
	.listen(3000)

console.dir({ main: app.dependencies }, { depth: 10 })
