import { t } from '../src/type'

const stacks = <any[]>[]
Bun.gc()
const m1 = process.memoryUsage().heapUsed
const t1 = performance.now()

for (let i = 0; i <= 100_000; i++)
	t.Numeric({ title: `t${i}`, minimum: i })

const t2 = performance.now()
Bun.gc()
const m2 = process.memoryUsage().heapUsed

console.log('Elysia 2')
console.log('Time:', t2 - t1, 'ms')
console.log('Heap used:', (m2 - m1) / 1024 / 1024, 'MB')
