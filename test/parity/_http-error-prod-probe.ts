// Production subprocess entry point; do not import it into the main test run.
// Prints one JSON payload for its caller.

import { Elysia, HTTPError } from '../../src'

// An owned error, its 500 detail is intentional
class Owned extends HTTPError<'OWNED'> {
	type = 'OWNED' as const
	override readonly status = 500

	detail() {
		return 'owned-detail'
	}
}

// Shaped like undici's ResponseStatusCodeError, never opted in
class Foreign extends Error {
	readonly status = 502
	readonly value = { detail: 'upstream-secret' }
}

// A status written as a name must still resolve for the `>= 500` mask
class NamedForeign extends Error {
	readonly status = 'Bad Gateway'
	readonly value = { detail: 'upstream-secret' }
}

// Owned, but body-less: the message must not leak past the 5xx mask just
// because the status was written as a name
class NamedOwned extends HTTPError<'NAMED_OWNED'> {
	type = 'NAMED_OWNED' as const
	override readonly status = 'Internal Server Error'
}

// A malformed status must not duck past the mask by failing `>= 500`
class NaNStatus extends Error {
	readonly status = NaN
	readonly value = { detail: 'upstream-secret' }
}

class ZeroStatus extends Error {
	readonly status = 0
	readonly value = { detail: 'upstream-secret' }
}

async function main() {
	const app = new Elysia()
		.get('/owned', () => {
			throw new Owned()
		})
		.get('/foreign', () => {
			throw new Foreign()
		})
		.get('/named-foreign', () => {
			throw new NamedForeign()
		})
		.get('/named-owned', () => {
			throw new NamedOwned('leaky-detail')
		})
		.get('/nan', () => {
			throw new NaNStatus()
		})
		.get('/zero', () => {
			throw new ZeroStatus()
		})

	const owned = await app
		.handle(new Request('http://localhost/owned'))
		.then(async (r) => ({ status: r.status, body: await r.text() }))

	const foreign = await app
		.handle(new Request('http://localhost/foreign'))
		.then(async (r) => ({ status: r.status, body: await r.text() }))

	const namedForeign = await app
		.handle(new Request('http://localhost/named-foreign'))
		.then(async (r) => ({ status: r.status, body: await r.text() }))

	const namedOwned = await app
		.handle(new Request('http://localhost/named-owned'))
		.then(async (r) => ({ status: r.status, body: await r.text() }))

	const nan = await app
		.handle(new Request('http://localhost/nan'))
		.then(async (r) => ({ status: r.status, body: await r.text() }))

	const zero = await app
		.handle(new Request('http://localhost/zero'))
		.then(async (r) => ({ status: r.status, body: await r.text() }))

	console.log(
		JSON.stringify({
			NODE_ENV: process.env.NODE_ENV,
			owned,
			foreign,
			namedForeign,
			namedOwned,
			nan,
			zero
		})
	)
}

main()
