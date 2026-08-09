// Import-graph heap cost. Single-shot (module cache makes repeats in-process
// meaningless) — run 3× in fresh processes, take median:
//   bun bench/import-heap.ts [entry=./src/index.ts]
import { heapStats } from 'bun:jsc'
import { resolve } from 'node:path'

const entry = resolve(process.argv[2] ?? './src/index.ts')

Bun.gc(true)
const heapBefore = heapStats().heapSize
const rssBefore = process.memoryUsage().rss

await import(entry)

Bun.gc(true)
console.log(
	JSON.stringify({
		entry,
		heapDelta: heapStats().heapSize - heapBefore,
		rssDelta: process.memoryUsage().rss - rssBefore
	})
)
