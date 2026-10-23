import { Elysia, t } from 'elysia'
import assert from 'node:assert/strict'

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

for (const aot of [true, false]) {
	for (const count of [0, 1, 2]) {
		const streamed = new Elysia({ aot }).get('/', ({ set, cookie }) => {
			set.headers['x-route'] = 'route'
			for (let i = 0; i < count; i++) cookie[`route${i}`].value = 'value'
			return new Response('hello', {
				status: 202,
				headers: [
					['transfer-encoding', 'chunked'],
					['x-response', 'original'],
					['set-cookie', 'a=1; Path=/'],
					['set-cookie', 'b=2; Path=/']
				]
			})
		})
		const result = await streamed.handle(new Request('http://localhost/'))
		assert.equal(result.status, 202)
		assert.equal(result.headers.get('x-response'), 'original')
		assert.equal(result.headers.get('x-route'), 'route')
		assert.deepEqual(result.headers.getSetCookie(), [
			'a=1; Path=/',
			'b=2; Path=/',
			...Array.from(
				{ length: count },
				(_, i) => `route${i}=value; Path=/`
			)
		])
		await result.body.cancel()
	}
}

console.log('✅ ESM Node.js preserves chunked response headers and cookies!')

process.exit()
