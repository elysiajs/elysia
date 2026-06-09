import { getHeapSpaceStatistics } from 'v8'
import { Elysia, t } from '../../src'
import { generateHeapSnapshot } from 'bun'

const memory = process.memoryUsage().heapTotal / 1024 / 1024

const total = 500
const sub = 1

const app = new Elysia()
const plugin = new Elysia()

const t1 = performance.now()

for (let i = 0; i < total * sub; i++)
	plugin.get(`/${i}`, () => 'hi', { response: t.String() })

app.use(plugin)

const t2 = performance.now()

Bun.gc(true)
const memoryAfter = process.memoryUsage().heapTotal / 1024 / 1024
const totalRoutes = total * sub
const totalTime = t2 - t1
const avgTimePerRoute = totalTime / totalRoutes

console.log(`${totalRoutes} routes took ${totalTime.toFixed(4)} ms`)
console.log(`Average ${avgTimePerRoute.toFixed(4)} ms per route`)
console.log(`${(memoryAfter - memory).toFixed(2)} MB memory used`)
