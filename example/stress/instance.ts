import { Elysia, t } from '../../src'

const total = 10_000

const setup = new Elysia({ name: 'setup' })
	.decorate('decorate', 'decorate')
	.state('state', 'state')
	.model('model', t.String())
	.error('error', Error)

const t1 = performance.now()

for (let i = 0; i < total; i++) new Elysia().use(setup)

const took = performance.now() - t1

console.log(
	Intl.NumberFormat().format(total),
	'instances took',
	+took.toFixed(4),
	'ms'
)
console.log('Average', +(took / total).toFixed(4), 'ms / instance')
