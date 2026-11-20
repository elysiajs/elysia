// A stream answer on an error exit writes its cookie on the first pull, after
// the settlement signed: the pull must sign it too, never send it unsigned,
// and a cookie that cannot be signed ends in the masked 500
import assert from 'node:assert/strict'

const log = console.error
console.error = () => {}

const lane = process.argv[2] as 'jit' | 'subtle' | 'aot'
if (lane === 'subtle') {
	;(Bun as any).CryptoHasher = undefined
	;(process as any).getBuiltinModule = undefined
}

const { Elysia, HTTPError } = await import('../../src')
const { hasSyncHmac, unsignCookie } = await import('../../src/cookie/crypto')
const { Compiled } = await import('../../src/compile/aot')
const { Validator } = await import('../../src/validator')
const { endHandlerCapture, endValidatorCapture } =
	await import('../../src/compile/aot-capture')
const { materialise, materialiseHandlers, registerManifest } =
	await import('../aot/_manifest')

assert.equal(hasSyncHmac, lane !== 'subtle')

class Teapot extends HTTPError.id('TEAPOT', 418) {}

const make = (build: () => any) => {
	if (lane !== 'aot') return build().compile()

	process.env.ELYSIA_AOT_BUILD = '1'
	build().compile()
	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	assert.ok(handlers.length > 0)
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

const exits: Record<string, [(app: any) => any, string]> = {
	route: [
		(app) =>
			app.get('/', () => {
				throw new Teapot()
			}),
		'/'
	],
	'async route': [
		(app) =>
			app.get('/', async () => {
				await Promise.resolve()
				throw new Teapot()
			}),
		'/'
	],
	'not-found': [(app) => app.get('/', () => 'x'), '/missing'],
	'on-request': [
		(app) =>
			app
				.onRequest(() => {
					throw new Teapot()
				})
				.get('/', () => 'x'),
		'/'
	]
}

const writers: Record<string, (app: any) => any> = {
	'onError generator': (app) =>
		app.onError(function* ({ set }: any) {
			set.cookie = { session: { value: 'raw-secret' } }
			yield 'streamed'
		}),
	'mapResponse generator on a declined error': (app) =>
		app
			.onError(() => {})
			.mapResponse(function* ({ set }: any) {
				set.cookie = { session: { value: 'raw-secret' } }
				yield 'streamed'
			})
}

let cases = 0
const failures: string[] = []
const check = (actual: unknown, expected: unknown, name: string) => {
	cases++
	if (actual !== expected)
		failures.push(`${name}: ${String(actual)} !== ${String(expected)}`)
}

for (const [exitName, [define, path]] of Object.entries(exits))
	for (const [writerName, writer] of Object.entries(writers))
		for (const secrets of ['s', [null, 's']] as any[]) {
			const name = `${exitName}, ${writerName}, secrets ${JSON.stringify(secrets)}`
			const app = make(() =>
				define(
					writer(
						new Elysia({
							cookie: { secrets, sign: ['session'] }
						})
					)
				)
			)

			const res = await app.handle(new Request(`http://localhost${path}`))
			const body = await res.text()
			const session = res.headers
				.getSetCookie()
				.map((cookie: string) => cookie.split(';')[0])
				.find((pair: string) => pair.startsWith('session='))

			if (secrets === 's') {
				check(body, 'streamed', `${name}: body`)
				check(
					session &&
						(await unsignCookie(
							decodeURIComponent(
								session.slice('session='.length)
							),
							's',
							'session'
						)),
					'raw-secret',
					`${name}: cookie signed`
				)
			} else {
				check(res.status, 500, `${name}: fails closed`)
				check(session, undefined, `${name}: no cookie sent`)
			}
		}

if (failures.length) {
	log(failures.join('\n'))
	process.exit(1)
}

console.log(`${cases} ${lane} stream signing cases passed`)
