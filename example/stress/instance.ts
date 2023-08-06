import { Elysia } from '../../src'

const total = 10_000

const t = performance.now()

for (let i = 0; i < total; i++) new Elysia()

const took = performance.now() - t

console.log(
	Intl.NumberFormat().format(total),
	'instances took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / instance')
