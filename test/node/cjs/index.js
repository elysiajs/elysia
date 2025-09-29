if ('Bun' in globalThis) {
	throw new Error('❌ Use Node.js to run this test!')
}

setTimeout(() => {
	console.log('❌ CJS Node.js timed out')
	process.exit(1)
}, 5000)

const { Elysia } = require('elysia')

const app = new Elysia().get('/', () => 'Node.js')

const main = async () => {
	const response = await app.handle(new Request('http://localhost'))

	if ((await response.text()) !== 'Node.js') {
		throw new Error('❌ CommonJS Node.js failed')
	}

	console.log('✅ CommonJS Node.js works!')
}
main()
