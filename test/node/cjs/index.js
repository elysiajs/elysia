if ('Bun' in globalThis) {
	throw new Error('❌ Use Node.js to run this test!')
}

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
) {
	throw new Error('❌ CommonJS Node.js adapter/utils subpath failed')
}

if (!('validators' in compiled) || !('handlers' in compiled)) {
	throw new Error('❌ CommonJS Node.js compiled subpath failed')
}

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

	process.exit()
}
main()
