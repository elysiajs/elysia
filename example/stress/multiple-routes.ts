import { Elysia, t } from '../../src'
import { generateHeapSnapshot } from 'bun'
import v8 from 'node:v8'

const total = 1000

{
	const app = new Elysia({ precompile: true })

	const t1 = performance.now()
	const memory = process.memoryUsage().heapTotal / 1024 / 1024

	for (let i = 0; i < total; i++)
		app.get(`/id/${i}`, () => 'hello', {
			body: t.String(),
			beforeHandle() {
				return { a: 'ok' }
			}
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

	const snapshot = generateHeapSnapshot()
	await Bun.write('heap.json', JSON.stringify(snapshot, null, 2))

	console.log(memoryAfter - memory, 'MB memory used')

	// Creates a heap snapshot file with an auto-generated name
	const snapshotPath = v8.writeHeapSnapshot()
	console.log(`Heap snapshot written to: ${snapshotPath}`)
}
