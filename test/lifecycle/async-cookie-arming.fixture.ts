// Select WebCrypto in an isolated process without disturbing the suite's HMAC
// singleton. All route modes must execute the asynchronous signing branch.
import assert from 'node:assert/strict'
;(Bun as any).CryptoHasher = undefined
;(process as any).getBuiltinModule = undefined
const { Elysia } = await import('../../src')
const { hasSyncHmac } = await import('../../src/cookie/crypto')
const { origin } = await import('../../src/adapter/origin')
const { Compiled } = await import('../../src/compile/aot')
const { Validator } = await import('../../src/validator')
const { endHandlerCapture, endValidatorCapture } =
	await import('../../src/compile/aot-capture')
const { materialise, materialiseHandlers, registerManifest } =
	await import('../aot/_manifest')
assert.equal(hasSyncHmac, false)

for (const mode of ['lazy', 'eager', 'frozen']) {
	for (const scenario of ['success', 'handled', 'fallback']) {
		let context: any
		const build = () => {
			const app = new Elysia({
				cookie: { sign: ['id'], secrets: 'secret' }
			}).transform((c: any) => {
				context = c
				assert.equal(c['~sig'], undefined)
				if (scenario !== 'success') {
					c.set.cookie = { id: { value: 'written-before-error' } }
					throw new Error('original')
				}
			})
			if (scenario === 'handled') app.error(() => 'handled')
			if (scenario === 'fallback') app.error(() => {})
			return app.get('/', ({ cookie }) => {
				// Raw verification was awaited before reaching this handler.
				assert.equal(context['~sig'] instanceof AbortSignal, true)
				cookie.id.value = 'signed-value'
				return 'ok'
			})
		}
		let app: any
		if (mode === 'frozen') {
			process.env.ELYSIA_AOT_BUILD = '1'
			build().compile()
			const handlers = endHandlerCapture()
			const validators = endValidatorCapture()
			delete process.env.ELYSIA_AOT_BUILD
			Validator.clear()
			registerManifest({
				handlers: materialiseHandlers(handlers),
				validators: materialise(validators)
			})
			app = build().compile()
		} else app = mode === 'eager' ? build().compile() : build()

		let reads = 0
		class ObservedRequest extends Request {
			get signal() {
				reads++
				return super.signal
			}
		}
		const request = new ObservedRequest('http://localhost/')
		const fetch = app.fetch
		origin.request = request
		let pending: Response | Promise<Response>
		try {
			pending = fetch(request)
		} finally {
			origin.request = undefined
		}
		const response = await pending
		assert.equal(response.status, scenario === 'success' ? 200 : 500)
		if (scenario !== 'fallback')
			assert.equal(
				await response.text(),
				scenario === 'success' ? 'ok' : 'handled'
			)
		assert.match(
			response.headers.get('set-cookie')!,
			/id=[^.]+\.[A-Za-z0-9%]+/
		)
		assert.equal(reads, 1)
		Compiled.clear()
		Validator.clear()
	}
}
console.log('9 cookie boundary cases passed')
