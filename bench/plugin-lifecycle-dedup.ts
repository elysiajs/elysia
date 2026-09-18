// Measures lifecycle callback absorption, not plugin construction.
// Run: `bun run bench/plugin-lifecycle-dedup.ts`

import { Elysia } from '../src'

const SMALL = 1_000
const LARGE = 4_000
const WARMUPS = 2
const SAMPLES = 9

const plugins = Array.from({ length: LARGE }, () =>
	new Elysia()
		.wrap((next) => next)
		.setup(() => {})
		.cleanup(() => {})
)
const smallPlugins = plugins.slice(0, SMALL)

const collect = () => {
	for (let i = 0; i < 5; i++) Bun.gc(true)
	return process.memoryUsage()
}

const measure = (fixtures: Elysia[]) => {
	const app = new Elysia()
	const start = performance.now()
	for (let i = 0; i < fixtures.length; i++) app.use(fixtures[i])
	const elapsed = performance.now() - start
	const ext = app['~ext']

	if (
		ext?.hoc?.length !== fixtures.length ||
		ext.setup?.length !== fixtures.length ||
		ext.cleanup?.length !== fixtures.length
	)
		throw new Error(
			`callback length mismatch at ${fixtures.length} plugins`
		)

	return elapsed
}

const median = (values: number[]) =>
	values.slice().sort((a, b) => a - b)[values.length >> 1]

for (let i = 0; i < WARMUPS; i++) {
	measure(smallPlugins)
	measure(plugins)
}

const before = collect()
const small: number[] = []
const large: number[] = []

for (let i = 0; i < SAMPLES; i++) {
	if (i & 1) {
		collect()
		large.push(measure(plugins))
		collect()
		small.push(measure(smallPlugins))
	} else {
		collect()
		small.push(measure(smallPlugins))
		collect()
		large.push(measure(plugins))
	}
}

const after = collect()
const smallMedian = median(small)
const largeMedian = median(large)
const ratio = largeMedian / smallMedian

console.log(`1k median: ${smallMedian.toFixed(2)} ms`)
console.log(`4k median: ${largeMedian.toFixed(2)} ms`)
console.log(`4k/1k ratio: ${ratio.toFixed(2)}`)
console.log(`post-GC heap delta: ${after.heapUsed - before.heapUsed} B`)
console.log(`post-GC RSS delta: ${after.rss - before.rss} B`)

if (ratio >= 8) throw new Error(`quadratic lifecycle merge ratio: ${ratio}`)
