import { t } from '../src/type'

const stacks = <any[]>[]
const t1 = performance.now()
const m1 = process.memoryUsage().heapUsed

console.log(t.File())

for (let i = 0; i <= 100_000; i++)
	stacks.push(
		t.Numeric({
			title: i + '',
			description: 'cool thing'
		})
	)

const t2 = performance.now()
const m2 = process.memoryUsage().heapUsed

console.log(stacks[50_000])
console.log(stacks[50_001])

console.log('Time:', t2 - t1, 'ms')
console.log('Memory:', (m2 - m1) / 1024 / 1024, 'MB')
