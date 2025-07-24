import { Elysia, t } from '../../src'
import v8 from 'v8'

const total = 500

{
	const app = new Elysia({ precompile: true })

	const t1 = performance.now()
	const memory = process.memoryUsage().heapTotal / 1024 / 1024

	for (let i = 0; i < total; i++)
		app.get(`/id/${i}`, () => 'hello', {
			response: t.String()
		})

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
	console.log(((memoryAfter - memory) / total) * 1024, 'KB memory used')

	// v8.writeHeapSnapshot()
}
