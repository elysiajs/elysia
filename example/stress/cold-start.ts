import { Elysia, t } from '../../src'
import { profile } from './utils'

const makeApp = () =>
	new Elysia()
		.get('/', () => 'ok')
		.get('/user/:id', ({ params: { id } }) => id)
		.post('/json', ({ body }) => body, {
			body: t.Object({ name: t.String(), age: t.Number() })
		})
		.get('/search', ({ query }) => query, {
			query: t.Object({ page: t.Number() })
		})

const N = 5_000
const times = new Array<number>(N)

for (let i = 0; i < N; i++) {
	const t1 = performance.now()
	const app = makeApp().compile()
	await app.handle(new Request('http://e.ly/'))
	times[i] = performance.now() - t1
}

times.sort((a, b) => a - b)
console.log('Cold-start (construct -> compile -> first response), warm module')
console.log('p50:', times[N >> 1].toFixed(4), 'ms')
console.log('p99:', times[Math.floor(N * 0.99)].toFixed(4), 'ms')
console.log('max:', times[N - 1].toFixed(4), 'ms\n')

// One profiled cold build for the memory-on-cold-start figure.
const stop = profile('Cold-start single app: construct + compile + 1 response')
const app = makeApp().compile()
await app.handle(new Request('http://e.ly/'))
stop()
