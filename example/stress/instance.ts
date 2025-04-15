import { Elysia, t } from '../../src'
import { generateHeapSnapshot } from 'bun'
import v8 from 'node:v8'

const total = 500

const apps = []

const setup = (n = 0) => {
	let app = new Elysia()

	for (let i = 0; i < 2; i++) {
		app.decorate(`a${i + n * total}`, () => i).get(
			`/a/${i + n * total}`,
			() => i
		)
	}

	apps.push(app)

	return app
}

const app = new Elysia()

const memory = process.memoryUsage().heapTotal / 1024 / 1024
const t1 = performance.now()

for (let i = 0; i < total; i++) app.use(setup(i))

apps.length = 0

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

// const snapshot = generateHeapSnapshot()
// await Bun.write('heap.json', JSON.stringify(snapshot, null, 2))

// console.log(app.router.history)

// Creates a heap snapshot file with an auto-generated name
// const snapshotPath = v8.writeHeapSnapshot()
// console.log(`Heap snapshot written to: ${snapshotPath}`)
