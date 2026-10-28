/* eslint-disable @typescript-eslint/no-unused-vars */

// WebSocket hook and handler types must describe what the socket runtime
// hands over, not the HTTP shape: each pin below was a crash or a silent
// drop at runtime while the types said otherwise.

import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { expectTypeOf } from 'expect-type'

const app = new Elysia().use(websocket())

// transform, beforeHandle and error also run at the upgrade, where no message
// exists yet, so reading `body` unguarded threw a 500 there
{
	app.ws('/upgrade-body', {
		body: t.Object({ name: t.String() }),
		transform({ body }) {
			expectTypeOf(body).toEqualTypeOf<{ name: string } | undefined>()
		},
		beforeHandle({ body }) {
			expectTypeOf(body).toEqualTypeOf<{ name: string } | undefined>()
		},
		error({ body }) {
			expectTypeOf(body).toEqualTypeOf<{ name: string } | undefined>()
		},
		message(ws, body) {
			// the message lane always has one
			expectTypeOf(body).toEqualTypeOf<{ name: string }>()
			expectTypeOf(ws.body).toEqualTypeOf<{ name: string }>()
		}
	})

	app.ws('/upgrade-body-read', {
		body: t.Object({ name: t.String() }),
		beforeHandle({ body }) {
			// @ts-expect-error undefined at the upgrade
			body.name
		},
		message() {}
	})
}

// the socket has no `defer`: calling it threw "ws.defer is not a function"
{
	app.ws('/defer', {
		open(ws) {
			// @ts-expect-error not on a socket
			ws.defer
		},
		message(ws) {
			// @ts-expect-error not on a socket
			ws.defer(() => {})
		}
	})

	app.ws('/defer-handler', (ws) => {
		// @ts-expect-error not on a socket
		ws.defer
	})
}

// a plain send/publish/return is validated against the 200 schema only;
// another status goes out through `status()`
{
	app.ws('/multi-status', {
		response: {
			200: t.Object({ ok: t.Boolean() }),
			400: t.Object({ reason: t.String() })
		},
		message(ws) {
			ws.send({ ok: true })
			ws.publish('topic', { ok: true })

			// @ts-expect-error refused at runtime: not the 200 shape
			ws.send({ reason: 'bad' })
			// @ts-expect-error refused at runtime: not the 200 shape
			ws.publish('topic', { reason: 'bad' })

			return ws.status(400, { reason: 'bad' })
		}
	})

	// @ts-expect-error a plain return is checked against 200
	app.ws('/multi-status-return', {
		response: {
			200: t.Object({ ok: t.Boolean() }),
			400: t.Object({ reason: t.String() })
		},
		message() {
			return { reason: 'bad' }
		}
	})
}

// a socket has no HTTP response for afterResponse to see
{
	app.ws('/after-response', {
		response: t.String(),
		afterResponse({ responseValue }) {
			expectTypeOf(responseValue).toBeUnknown()
		},
		message() {
			return 'sent'
		}
	})
}

// an HTTP body serializes to "{}" as a frame
{
	// a response schema already refuses one
	// @ts-expect-error not the 200 shape
	app.ws('/schema-response', {
		response: t.String(),
		message: () => new Response('hello')
	})

	// also on the `(path, handler)` form: a handler failing that overload must
	// not be silently taken as the options object (`[Symbol.hasInstance]` guard)
	const guarded = new Elysia()
		.use(websocket())
		.guard({ response: t.String() })
	// @ts-expect-error a Response is not the 200 shape
	guarded.ws('/guard-response', () => new Response('hello'))
	// @ts-expect-error a number is not the 200 shape
	guarded.ws('/guard-number', () => 1)
	// @ts-expect-error the handler gets the socket, not a number
	app.ws('/bad-param', (ws: number) => 'x')

	// KNOWN GAP: schemaless, the return stays `unknown` so an echo of the
	// `unknown` body compiles (DX call); a Response/Blob/Map returned there
	// still type-checks and is sent as "{}"
	app.ws('/echo', (ws, message) => message)
	app.ws('/echo-object', {
		message(ws, message) {
			return message
		}
	})
	app.ws('/schemaless-response', () => new Response('hello'))

	// frames still type-check, and `~Routes` records them
	interface Payload {
		id: number
	}

	const frames = new Elysia()
		.use(websocket())
		.ws('/string', () => 'text')
		.ws('/object', () => ({ ok: true }))
		.ws('/interface', () => ({ id: 1 }) as Payload)
		.ws('/bytes', () => new Uint8Array(1))
		.ws('/async', async () => ({ ok: true }))
		.ws('/void', () => {})
		.ws('/generator', function* () {
			yield 'a'
		})

	type Routes = (typeof frames)['~Routes']
	expectTypeOf<
		Routes['object']['subscribe']['response'][200]
	>().toEqualTypeOf<{ ok: boolean }>()
	expectTypeOf<
		Routes['interface']['subscribe']['response'][200]
	>().toEqualTypeOf<Payload>()
}

// afterHandle runs after the message was sent: what it returns is dropped
{
	app.ws('/after-handle', {
		response: t.String(),
		afterHandle() {},
		message() {
			return 'original'
		}
	})

	app.ws('/after-handle-async', {
		response: t.String(),
		async afterHandle() {},
		message() {}
	})

	// @ts-expect-error dropped at runtime
	app.ws('/after-handle-return', {
		response: t.String(),
		afterHandle() {
			return 'override'
		},
		message() {}
	})
}
