import { Elysia, t } from '../src/2'

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

// new Elysia().get('/', () => 'q').compile()

const m1 = memoryUsage()
const t1 = performance.now()
const total = 30000
const stacks = <any[]>Array(total)

for (let i = 0; i < total; i++) {
	const app = new Elysia().get('/:id/a', () => 'ok', {
		params: t.Object({
			id: t.Number({
				title: i + ''
			})
		})
	})

	app.handler(0, true)
	// app.fetch

	stacks[i] = app
}

const t2 = performance.now()
gc()
const m2 = memoryUsage()

// console.log('\n\n\n')
console.log('Elysia 2α full compile x30k')
console.log('Time:', (t2 - t1).toFixed(2), 'ms')
console.log('Memory usage:', ((m2 - m1) / 1024 / 1024).toFixed(2), 'MB')
// console.log('\n\n\n\n\n\n')
