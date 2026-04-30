import { Elysia, t } from '../src/2'

const a = new Elysia().derive('plugin', () => ({
	a: 'a'
}))

const app = new Elysia().use(a).get('/', ({ a }) => a)

console.log(app.handler(0, true).toString())

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
