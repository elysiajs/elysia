import { Elysia } from '../../src'

const app = new Elysia()
const total = 10_000

const t = performance.now()

for (let i = 0; i < total; i++) app.get(`/id/${i}`, () => 'hello')

const took = performance.now() - t

console.log(
	Intl.NumberFormat().format(total),
	'routes took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / route')
