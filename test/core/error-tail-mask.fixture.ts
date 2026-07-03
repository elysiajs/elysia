// Spawned by error-tail-mask.test.ts with NODE_ENV toggled. `isProduction`
// (src/error.ts) reads env at call time, but the COMPILED error tail links it as
// `isprod` and must reflect the runtime env — so we exercise it from a fresh
// process with NODE_ENV pre-set. Prints a JSON map of { scenario: { status, body } }.
//
// Every app attaches a no-op `.error()` hook: that routes errors through the
// compiled jit tail (src/compile/handler/jit.ts) instead of the fetch-level
// interpreted handler — the exact path H22 says was missing the 5xx mask.
import { Elysia } from '../../src'

const get = () => new Request('http://localhost/')

const throwing = (mut: (e: any) => void) =>
	new Elysia().error(() => {}).get('/', () => {
		const e: any = new Error('secret: db password is hunter2')
		mut(e)
		throw e
	})

// H22: a user error class whose `toResponse()` throws SYNCHRONOUSLY. The
// interpreted `fallbackResponse` (src/handler/error.ts) wraps `toResponse()` in
// try/catch and falls back to the ORIGINAL error (5xx-mask/es/ise). The compiled
// tail must mirror that: a sync throw from `toResponse()` must NOT escape with
// the WRONG (inner) error and leak `INNER-THROW-LEAK` / lose the 503 status.
class ThrowingToResponse extends Error {
	status = 503
	constructor() {
		super('original 503 message')
		this.name = 'ThrowingToResponse'
	}
	toResponse(): Response {
		throw new Error('INNER-THROW-LEAK')
	}
}

// compiled tail (has an .error() hook) — the path the fix touches
const compiledThrow = () =>
	new Elysia()
		.error(() => {})
		.get('/', () => {
			throw new ThrowingToResponse()
		})
		.handle(get())

// interpreted path (no .error() hook) — the reference behavior to match
const interpretedThrow = () =>
	new Elysia()
		.get('/', () => {
			throw new ThrowingToResponse()
		})
		.handle(get())

const scenarios: Record<string, () => Promise<Response>> = {
	// 5xx with a message → masked to 'Internal Server Error' in production
	fiveHundred: () => throwing((e) => (e.status = 500)).handle(get()),

	// explicit e.response ALWAYS wins, even for 5xx in production (parity with
	// fallbackErrorResponse: `error.response !== undefined ? error.response : ...`)
	explicitResponse: () =>
		throwing((e) => {
			e.status = 500
			e.response = 'explicit body'
		}).handle(get()),

	// 4xx is a client error → message is NOT masked (only >= 500)
	fourHundred: () => throwing((e) => (e.status = 400)).handle(get()),

	// higher 5xx also masked
	fiveOhThree: () => throwing((e) => (e.status = 503)).handle(get()),

	// H22 sync-throw: compiled tail must fall back to the ORIGINAL error, not
	// leak the inner throw. Prod → 5xx masked; dev → original message. The
	// interpreted twin is the reference the compiled path must match.
	syncThrowCompiled: compiledThrow,
	syncThrowInterpreted: interpretedThrow
}

const out: Record<string, { status: number; body: string }> = {}
for (const key in scenarios) {
	const res = await scenarios[key]!()
	out[key] = { status: res.status, body: await res.text() }
}

console.log(JSON.stringify(out))
