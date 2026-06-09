import { Elysia, t } from 'elysia'

if ('Bun' in globalThis) {
	throw new Error('❌ Use Node.js to run this test!')
}

setTimeout(() => {
	console.log('❌ ESM Node.js timed out')
	process.exit(1)
}, 5000)

const app = new Elysia().get('/', () => 'Node.js', {
	response: t.String()
})

const response = await app.handle(new Request('http://localhost'))

if ((await response.text()) !== 'Node.js') {
	throw new Error('❌ ESM Node.js failed')
}

console.log('✅ ESM Node.js works!')

process.exit()
