import { Elysia, t } from '../../src'

const total = 1000
const sub = 50

const app = new Elysia()

const memory = process.memoryUsage().heapTotal / 1024 / 1024
console.log(`${total} Elysia instances with ${sub} decorations each`)

const t1 = performance.now()

for (let i = 0; i < total; i++) {
	const plugin = new Elysia()

	for (let j = 0; j < sub; j++)
		plugin.decorate('a', {
			[`value-${i * sub + j}`]: 1
		})

	app.use(plugin)
}

const t2 = performance.now()

Bun.gc(true)

const memoryAfter = process.memoryUsage().heapTotal / 1024 / 1024
console.log(+(memoryAfter - memory).toFixed(2), 'MB memory used')
console.log('total', +(t2 - t1).toFixed(2), 'ms')
console.log(+((t2 - t1) / (total * sub)).toFixed(6), 'decoration/ms')
