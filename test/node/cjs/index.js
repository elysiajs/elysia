if ('Bun' in globalThis) throw new Error('❌ Use Node.js to run this test!')

setTimeout(() => {
	console.log('❌ CJS Node.js timed out')
	process.exit(1)
}, 5000)

const { Elysia, t } = require('elysia')
const adapterUtils = require('elysia/adapter/utils')
const compiled = require('elysia/compiled')

if (
	typeof adapterUtils.createResponseHandler !== 'function' ||
	typeof adapterUtils.createStreamHandler !== 'function'
)
	throw new Error('❌ CommonJS Node.js adapter/utils subpath failed')

if (!('validators' in compiled) || !('handlers' in compiled))
	throw new Error('❌ CommonJS Node.js compiled subpath failed')

const app = new Elysia().get(
	'/',
	{
		response: t.String()
	},
	() => 'Node.js'
)

const main = async () => {
	const response = await app.handle(new Request('http://localhost'))

	if ((await response.text()) !== 'Node.js') {
		throw new Error('❌ CommonJS Node.js failed')
	}

	console.log('✅ CommonJS Node.js works!')

	const streamApp = new Elysia().get('/stream', async function* () {
		yield 'hello'
		yield ' world'
	})

	const streamRes = await streamApp.handle(
		new Request('http://localhost/stream')
	)
	const reader = streamRes.body.getReader()
	const chunks = []

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		if (!(value instanceof Uint8Array))
			throw new Error(
				`❌ C14: stream chunk is ${value?.constructor?.name ?? typeof value}, expected Uint8Array`
			)

		chunks.push(value)
	}

	const text = chunks.map((c) => new TextDecoder().decode(c)).join('')
	if (text !== 'hello world')
		throw new Error(
			`❌ C14: stream text is "${text}", expected "hello world"`
		)

	console.log('✅ CommonJS Node.js stream chunks are Uint8Array')

	process.exit()
}
main()
