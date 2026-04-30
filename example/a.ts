import { Elysia, t } from '../src/2'

const a = new Elysia()
	.derive('plugin', () => ({
		a: 'a'
	}))
	.derive('plugin', () => ({
		b: 'b'
	}))

const app = new Elysia().use(a).get('/', ({ a, b }) => [a, b])

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
