import { Elysia, t } from '../src'

let i = 0

const plugin1 = new Elysia({ prefix: '/not-call' }).get('/', () => 'asdf')

const plugin2 = new Elysia({ prefix: '/call' })
	.derive('global', ({ request }) => {
		i++ // <-- should not be called, when requesting /asdf
		return { test: 'test' }
	})
	.get('/', ({ test }) => test)

const app = new Elysia().use(plugin1).use(plugin2)

await Promise.all(['/not-call', '/call'].map((path) => app.handle(path)))

console.log(i) // .toBe(1)
