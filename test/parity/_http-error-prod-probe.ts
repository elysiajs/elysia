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

// Owned and body-less beyond 500: the masked `detail` names the status served
class Owned503 extends HTTPError.id('OWNED_503', 503) {}

class Owned502 extends HTTPError<'OWNED_502'> {
	type = 'OWNED_502' as const
	override readonly status = 502
}

// Only implements the contract, so everything it controls beyond `type` and
// `status` stays untrusted: knobs, headers, `code` and message
const invoked: string[] = []

class Implementer extends Error implements HTTPError<'IMPLEMENTER'> {
	readonly type = 'IMPLEMENTER'
	readonly code = 'implementer-code'
	readonly status = 503
	readonly headers = { 'x-implementer': 'implementer-header' }

	detail() {
		invoked.push('detail')
		return 'implementer-detail'
	}

	value() {
		invoked.push('value')
		return { secret: 'implementer-value' }
	}
}

// Answers the claim with a string, then anything else: what reaches the
// wire has to be the read the claim was checked on
class FlipType extends Error {
	readonly status = 503
	#reads = 0

	get type(): unknown {
		return this.#reads++ === 0 ? 'FLIP' : { marker: 'second-read' }
	}
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
		.get('/owned-503', () => {
			throw new Owned503('db-secret')
		})
		.get('/owned-502', () => {
			throw new Owned502('upstream-secret')
		})
		.get('/implementer-thrown', () => {
			throw new Implementer('implementer-secret')
		})
		.get('/implementer-returned', () => new Implementer('implementer-secret'))
		.get('/flip-type', () => {
			throw new FlipType('flip-secret')
		})

	const served = (path: string) =>
		app.handle(new Request(`http://localhost${path}`)).then(async (r) => ({
			status: r.status,
			contentType: r.headers.get('content-type'),
			header: r.headers.get('x-implementer'),
			body: await r.text()
		}))

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

	const owned503 = await served('/owned-503')
	const owned502 = await served('/owned-502')
	const implementerThrown = await served('/implementer-thrown')
	const implementerReturned = await served('/implementer-returned')
	const flipType = await served('/flip-type')

	console.log(
		JSON.stringify({
			NODE_ENV: process.env.NODE_ENV,
			owned,
			foreign,
			namedForeign,
			namedOwned,
			nan,
			zero,
			owned503,
			owned502,
			implementerThrown,
			implementerReturned,
			flipType,
			invoked
		})
	)
}

main()
