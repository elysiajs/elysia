import { Elysia, t } from '../../src'
import { run, bench, group, summary } from 'mitata'

const app = new Elysia()
	.get('/', () => 'ok')
	.get('/user/:id', ({ params: { id } }) => id)
	.post(
		'/json',
		{
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ body }) => body
	)
	.get(
		'/search',
		{
			query: t.Object({ page: t.Number(), limit: t.Number() })
		},
		({ query }) => query
	)
	.get(
		'/me',
		{
			cookie: t.Object({ session: t.Optional(t.String()) })
		},
		({ cookie: { session } }) => session.value
	)

const handle = app.handle

const body = JSON.stringify({ name: 'saltyaom', age: 21 })
// A POST body is a single-use stream, so unlike the GETs we can't reuse one
// Request — but `clone()` is ~5× cheaper than `new Request` (153ns vs 751ns) and
// leaves the prebuilt original unconsumed, so each op gets a fresh body while the
// measured cost is framework dispatch (route + parse + validate + handler +
// encode), not Request construction. Before this, `new Request` was ~43% of the
// reported POST op, inflating it vs the (reuse-based) GET numbers.
const postBase = new Request('http://e.ly/json', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body
})
const post = () => postBase.clone()

// Reuse prebuilt no-body Requests so the measured op is framework dispatch,
// not `new Request` construction (~155ns, which dominated the cheap GET path).
const getRoot = new Request('http://e.ly/')
const getUser = new Request('http://e.ly/user/42')
const getSearch = new Request('http://e.ly/search?page=2&limit=20')
const getMe = new Request('http://e.ly/me', {
	headers: { cookie: 'session=abc' }
})

await handle(getRoot)
await handle(getUser)
await handle(post())
await handle(getSearch)
await handle(getMe)

summary(() => {
	group('throughput (per-route, isolated)', () => {
		bench('GET / (plain)', () => handle(getRoot))
		bench('GET /user/:id (dynamic)', () => handle(getUser))
		bench('POST /json (body validate)', () => handle(post()))
		bench('GET /search (query coerce)', () => handle(getSearch))
		bench('GET /me (cookie)', () => handle(getMe))
	})

	// Mixed traffic: rotate across all 5 routes per op so the radix lookup +
	// compiled handlers can't stay perfectly monomorphic — closer to a server
	// fielding varied paths (additive, not a replacement for the isolated ones).
	group('throughput (mixed traffic)', () => {
		const gets = [getRoot, getUser, getSearch, getMe]
		let i = 0
		bench('rotate all 5 routes', () => {
			const n = i++ % 5
			return handle(n === 4 ? post() : gets[n])
		})
	})
})

await run()
