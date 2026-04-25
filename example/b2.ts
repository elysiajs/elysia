import { t } from '../src/2/type'
import { Elysia } from '../src/2'
import { Validator } from '../src/2/schema/validator'

function gc() {
	if (typeof Bun !== 'undefined') Bun.gc(true)
	else if (typeof global.gc === 'function') global.gc()
}

function memoryUsage() {
	if (typeof Bun !== 'undefined') {
		const { memoryUsage } = require('bun:jsc')

		gc()
		return memoryUsage().current
	}

	Validator.clear()
	gc()
	return process.memoryUsage().heapUsed
}

// new Elysia().get('/', () => 'q').compile()

const total = 100_000
gc()
const m1 = memoryUsage()
const t1 = performance.now()

const app = new Elysia()

for (let i = 0; i < total; i++) app.get(`/${i}`, () => 'ok')

await app.fetch(new Request('http://localhost/0'))

const t2 = performance.now()
gc()
const m2 = memoryUsage()

// console.log('\n\n\n')
console.log('Elysia 2α add route x100k + fetch once')
console.log('Time:', (t2 - t1).toFixed(2), 'ms')
console.log('Memory usage:', ((m2 - m1) / 1024 / 1024).toFixed(2), 'MB')
// console.log('\n\n\n\n\n\n')

// await handler({
// 	set: {
// 		status: 200,
// 		headers: {}
// 	},
// 	request: new Request('http://localhost?a=b', {
// 		method: 'GET',
// 		headers: {
// 			'content-type': 'application/json'
// 		},
// 		body: JSON.stringify([
// 			{
// 				name: 'q'
// 			}
// 		])
// 	})
// })
// 	.then((res) => res.text())
// 	.then(console.log)
