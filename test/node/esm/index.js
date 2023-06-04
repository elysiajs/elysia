import { Elysia } from 'elysia'

if ('Bun' in globalThis) {
	throw new Error('❌ Use Node.js to run this test!')
}

const app = new Elysia().get('/', () => 'Node.js')

const response = await app.handle(new Request('http://localhost'))

if ((await response.text()) !== 'Node.js') {
	throw new Error('❌ ESM Node.js failed')
}

console.log('✅ ESM Node.js works!')
