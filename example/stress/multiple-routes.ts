import { Elysia } from '../../src'

const app = new Elysia({ precompile: true })

const total = 200
const t = performance.now()

const memory = process.memoryUsage().heapTotal / 1024 / 1024

for (let i = 0; i < total; i++) app.get(`/id/${i}`, () => 'hello')

const memoryAfter = process.memoryUsage().heapTotal / 1024 / 1024

const took = performance.now() - t

console.log(
	Intl.NumberFormat().format(total),
	'routes took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / route')

console.log({ memory, memoryAfter })
console.log(memoryAfter - memory, 'MB memory used')

app.listen(3000)

// console.log(app.router.history)
