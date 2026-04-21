import { Elysia, t } from '../src/2'
// import { profile } from './vis'

function gc() {
	if (typeof Bun !== 'undefined') Bun.gc(true)
	else if (typeof global.gc === 'function') global.gc()
}

function memoryUsage() {
	if (typeof Bun !== 'undefined') {
		const { memoryUsage } = require('bun:jsc')

		gc()
		return memoryUsage().current
	}

	gc()
	return process.memoryUsage().heapUsed
}

gc()
const m1 = memoryUsage()
const t1 = performance.now()
// const stop = profile('a')

const app = new Elysia()

for (let i = 0; i < 300; i++) {
	app.get(
		`/${i}/a`,
		({ set }) => {
			set.headers['x-hello'] = 'world'

			return 'ok'
		},
		// {
		// 	query: t.Object({
		// 		name: t.Number()
		// 	})
		// }
	)

	// app.handler(i, true)
}

app.listen(4002)

const t2 = performance.now()
// gc()
const m2 = memoryUsage()

console.log('Time:', t2 - t1, 'ms')
console.log('Memory:', (m2 - m1) / 1024 / 1024, 'MB')

// import { generateHeapSnapshot } from "bun";

// console.log("Generating heap snapshot...");

// const snapshot = generateHeapSnapshot();
// await Bun.write("heap.json", JSON.stringify(snapshot, null, 2));

// console.log("Heap snapshot saved to heap.json");

// process.exit(0)
