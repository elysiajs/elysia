import { t } from '../src/type'
import { Elysia } from '../src/elysia'
import { compileHandler } from '../src/compile'

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

	gc()
	return process.memoryUsage().heapUsed
}

const app = new Elysia()

const total = 100_000
const stacks = <any[]>Array(total)
const m1 = memoryUsage()
const t1 = performance.now()

const route = [
	'/',
	'POST',
	({ body }) => 'q',
	{
		body: t.Array(
			t.Object({
				name: t.String(),
				age: t.Number({
					default: 1
				})
			})
		)
	},
	app
]

for (let i = 0; i <= total; i++) stacks.push(compileHandler(route, app))

const t2 = performance.now()
gc()
const m2 = memoryUsage()

// console.log('\n\n\n')
console.log('Elysia 2 incomplete compile x100_000')
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
