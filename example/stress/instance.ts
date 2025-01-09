import { Elysia, t } from '../../src'

const total = 100

const setup = (n = 0) => {
	const app = new Elysia()

	for(let i = 0; i < 10; i++) {
		app.get(`/:a/${i + (n * total)}`, () => i)
	}

	return app
}

const app = new Elysia()

const memory = process.memoryUsage().heapTotal / 1024 / 1024
const t1 = performance.now()

for (let i = 0; i < total; i++) app.use(setup(i))

const memoryAfter = process.memoryUsage().heapTotal / 1024 / 1024
const took = performance.now() - t1

console.log(
	Intl.NumberFormat().format(total),
	'routes took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / route')
console.log(memoryAfter - memory, 'MB memory used')
