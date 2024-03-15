import { Elysia, t } from '../../src'

const total = 10_000

const setup = () => new Elysia()

const t1 = performance.now()
for (let i = 0; i < total; i++) setup()

const took = performance.now() - t1

console.log(
	Intl.NumberFormat().format(total),
	'instances took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / instance')
