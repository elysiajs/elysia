import { Elysia, t } from '../../src'

// Deterministic codegen canary.
//
// Timings on a shared CI runner are noise; the *length of the emitted handler
// source* is not — it is byte-identical across runs and machines. Emitted-size
// regressions in this codebase have repeatedly preceded real throughput
// cliffs (an extra branch or a re-added inline copy shows up here long before
// it clears the noise floor of a wall-clock bench), so this is reported as a
// signal, never as a gate.
//
// One app, canonical route shapes. The hooked route lives inside a scoped
// `guard` callback so `derive`/`beforeHandle` don't leak into the plain,
// body-validated and query-validated routes — otherwise every route would
// measure the hook chain.

const app = new Elysia()
	// (a) plain sync
	.get('/plain', () => 'ok')
	// (b) sync + derive + guard(headers) + beforeHandle, scoped to this route
	.guard(
		{
			headers: t.Object({ authorization: t.Optional(t.String()) })
		},
		(app) =>
			app
				.derive(() => ({ user: { id: 1 } }))
				.beforeHandle(() => {})
				.get('/hooked', () => 'ok')
	)
	// (c) async + body + response validation
	.post(
		'/users',
		{
			body: t.Object({ name: t.String(), age: t.Number() }),
			response: t.Object({ name: t.String(), age: t.Number() })
		},
		async ({ body }) => body
	)
	// (d) query validation + coercion
	.get(
		'/search',
		{
			query: t.Object({ q: t.String(), page: t.Optional(t.Number()) })
		},
		({ query }) => query
	)

app.compile()

interface Probe {
	label: string
	method: string
	path: string
	request: () => Request
}

const probes: Probe[] = [
	{
		label: 'GET /plain (plain sync)',
		method: 'GET',
		path: '/plain',
		request: () => new Request('http://e.ly/plain')
	},
	{
		label: 'GET /hooked (derive+guard+beforeHandle)',
		method: 'GET',
		path: '/hooked',
		request: () =>
			new Request('http://e.ly/hooked', {
				headers: { authorization: 'Bearer x' }
			})
	},
	{
		label: 'POST /users (async body+response)',
		method: 'POST',
		path: '/users',
		request: () =>
			new Request('http://e.ly/users', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'saltyaom', age: 21 })
			})
	},
	{
		label: 'GET /search (query coerce)',
		method: 'GET',
		path: '/search',
		request: () => new Request('http://e.ly/search?q=a&page=2')
	}
]

const resolve = (entry: unknown): ((...args: any[]) => unknown) | undefined => {
	if (typeof entry === 'function') return entry as any
	if (!entry || typeof entry !== 'object') return undefined

	const record = entry as Record<string, unknown>
	const direct = record.f ?? record.handler
	if (typeof direct === 'function') return direct as any

	return Object.values(record).find((value) => typeof value === 'function') as
		| ((...args: any[]) => unknown)
		| undefined
}

for (const probe of probes) {
	try {
		// JIT is lazy: the compiled source only exists once the route has been
		// dispatched at least once, so drive it before reading `~map`.
		const response = await app.handle(probe.request())
		// Every probe must be a real 200. A 404 means the route never matched
		// and a 422 means we'd be sizing the validation-failure path, so both
		// invalidate the number — surface them instead of reporting bytes.
		if (response.status !== 200) {
			console.log(
				`emitted ${probe.label}: error status ${response.status} (expected 200)`
			)
			continue
		}

		const map = (app as any)['~map']
		const entry = map?.[probe.method]?.[probe.path]
		const fn = resolve(entry)

		if (!fn) {
			console.log(
				`emitted ${probe.label}: error unresolved (${probe.method} ${probe.path}, entry ${typeof entry})`
			)
			continue
		}

		console.log(`emitted ${probe.label}: ${fn.toString().length} bytes`)
	} catch (error) {
		console.log(
			`emitted ${probe.label}: error ${
				error instanceof Error ? error.message : String(error)
			}`
		)
	}
}
