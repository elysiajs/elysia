import { Elysia, t } from '../../src'

const total = 100
const sub = 5

const app = new Elysia({ precompile: true })

const memory = process.memoryUsage().heapTotal / 1024 / 1024
const t1 = performance.now()

for (let i = 0; i < total; i++) {
	const plugin = new Elysia()

	for (let j = 0; j < sub; j++) plugin.get(`/${i * sub + j}`, () => 'hi')

	app.use(plugin)
}

const t2 = performance.now()

Bun.gc(true)

const memoryAfter = process.memoryUsage().heapTotal / 1024 / 1024
console.log(+(memoryAfter - memory).toFixed(2), 'MB memory used')
console.log(+(t2 - t1).toFixed(2), 'ms')
