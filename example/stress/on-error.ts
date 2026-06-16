// A/B harness for the `onError` per-request closure allocation on the sync
// fast path (src/handler/fetch.ts). Reuses a prebuilt no-body Request so the
// measured op is framework dispatch, not Request construction.
import { Elysia } from '../../src'
import { run, bench, summary } from 'mitata'

const app = new Elysia()
	.get('/', () => 'ok')
	.get('/json', () => ({ hello: 'world' }))

const handle = app.handle

const get = new Request('http://e.ly/')
const json = new Request('http://e.ly/json')

// warm both routes (compile + JIT)
for (let i = 0; i < 2000; i++) {
	handle(get)
	handle(json)
}

summary(() => {
	// sync handlers → no Promise → onError closure is allocated then discarded
	bench('sync GET / (string)', () => handle(get))
	bench('sync GET /json (object)', () => handle(json))
})

await run()
