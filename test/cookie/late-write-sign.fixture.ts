// A response body can run user code while it is mapped: a generator on its
// first pull, a promise or a function inside `status()`. A signed cookie
// written there is written after the route signed. It must be signed where
// cookies are serialised, never sent as written
import assert from 'node:assert/strict'

const log = console.error
console.error = () => {}

const lane = process.argv[2] as 'jit' | 'subtle' | 'aot'
if (lane === 'subtle') {
	;(Bun as any).CryptoHasher = undefined
	;(process as any).getBuiltinModule = undefined
}

const { Elysia, status } = await import('../../src')
const { websocket } = await import('../../src/plugin/websocket')
const { hasSyncHmac, unsignCookie } = await import('../../src/cookie/crypto')
const { Compiled } = await import('../../src/compile/aot')
const { Validator } = await import('../../src/validator')
const { endHandlerCapture, endValidatorCapture } =
	await import('../../src/compile/aot-capture')
const { materialise, materialiseHandlers, registerManifest } =
	await import('../aot/_manifest')

assert.equal(hasSyncHmac, lane !== 'subtle')

let replayed = 0

const make = (build: () => any) => {
	if (lane !== 'aot') return build().compile()

	process.env.ELYSIA_AOT_BUILD = '1'
	build().compile()
	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	replayed += handlers.length
	Validator.clear()
	registerManifest({
		handlers: materialiseHandlers(handlers),
		validators: materialise(validators)
	})

	const app = build().compile()
	Compiled.clear()
	Validator.clear()

	return app
}

const cookie = { secrets: 's', sign: ['session'] }

type Write = () => void
const generator = (write: Write) =>
	(async function* () {
		write()
		yield 'a'
	})()

// `stream`: the body is pulled by the stream handler, which can wait for an
// async signer. The others are mapped synchronously
const shapes: Record<string, [(write: Write) => unknown, stream: boolean]> = {
	generator: [generator, true],
	'status(generator)': [(write) => status(200, generator(write)), true],
	'status(promise of generator)': [
		(write) => status(200, Promise.resolve(generator(write))),
		true
	],
	'status(promise that writes)': [
		(write) =>
			status(
				200,
				Promise.resolve().then(() => (write(), 'a'))
			),
		false
	],
	'status(function that writes)': [
		(write) => status(200, () => (write(), 'a')),
		false
	]
}

const exits: Record<string, (answer: (c: any) => unknown) => any> = {
	handler: (answer) => new Elysia({ cookie }).get('/', (c: any) => answer(c)),
	'async handler': (answer) =>
		new Elysia({ cookie }).get('/', async (c: any) => answer(c)),
	'onError answer': (answer) =>
		new Elysia({ cookie })
			.onError((c: any) => answer(c))
			.get('/', () => {
				throw new Error('x')
			}),
	'mapResponse on a declined error': (answer) =>
		new Elysia({ cookie })
			.mapResponse((c: any) => answer(c) as any)
			.onError(() => {})
			.get('/', () => {
				throw new Error('x')
			}),
	'onError answer on a 404': (answer) =>
		new Elysia({ cookie }).onError((c: any) => answer(c)),
	// no cookie exists yet when these two answer
	'onRequest answer': (answer) =>
		new Elysia({ cookie })
			.onRequest((c: any) => answer(c))
			.get('/', () => 'unreached'),
	'WebSocket upgrade answered in beforeHandle': (answer) =>
		new Elysia({ cookie }).use(websocket()).ws('/', {
			beforeHandle: (c: any) => answer(c),
			message() {}
		})
}

let cases = 0

for (const [exit, build] of Object.entries(exits))
	for (const [shape, [body, stream]] of Object.entries(shapes)) {
		const app = make(() =>
			build((c) =>
				body(() => {
					// onRequest and the 404 exit hand the hook no jar
					const jar = c.cookie ?? (c.set.cookie ??= {})

					if (jar.session) jar.session.value = 'raw-secret'
					else jar.session = { value: 'raw-secret' }
				})
			)
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				headers: exit.startsWith('WebSocket')
					? { upgrade: 'websocket' }
					: {}
			})
		)
		await response.text()

		const sent = response.headers.getSetCookie()
		const label = `${lane}: ${exit}, ${shape}`

		for (const value of sent) {
			if (!value.startsWith('session=')) continue

			const wire = decodeURIComponent(
				value.slice('session='.length).split(';')[0]!
			)
			assert.notEqual(wire, 'raw-secret', `${label} sent it unsigned`)
			assert.equal(
				await unsignCookie(wire, 's', 'session'),
				'raw-secret',
				`${label} sent a signature that does not verify`
			)
		}

		// a sync signer signs every shape. An async one is awaited by the
		// stream handler; elsewhere the cookie is either signed in time or
		// the response fails closed, it is never dropped from a 200
		if (hasSyncHmac || stream)
			assert.equal(sent.length, 1, `${label} lost the cookie`)
		else
			assert.ok(
				response.status === 500 || sent.length === 1,
				`${label} dropped the cookie from a ${response.status}`
			)

		cases++
	}

// the AOT lane replayed built handlers, it did not compile live
if (lane === 'aot') assert.ok(replayed >= 20)

console.error = log
console.log(`${cases} ${lane} late cookie cases passed`)
