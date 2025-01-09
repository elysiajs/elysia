import { Elysia } from '../../src'

const total = 1000

{
	console.log('Elysia')

	const app = new Elysia({ precompile: true })
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

	console.log(memoryAfter - memory, 'MB memory used')
}
