import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const isBun = typeof Bun !== 'undefined'
const jsc = isBun ? await import('bun:jsc') : undefined
const v8 = isBun ? undefined : await import('node:v8')
const file = fileURLToPath(import.meta.url)
const useDist = !isBun || process.argv.includes('--dist')
const entry = new URL(
	useDist ? '../dist/index.mjs' : '../src/index.ts',
	import.meta.url
)
const { Elysia } = await import(entry.href)

const argument = (name, fallback) => {
	const value = process.argv.find((item) => item.startsWith(`--${name}=`))
	return value === undefined ? fallback : value.slice(name.length + 3)
}

const forceGc = () => {
	for (let i = 0; i < 3; i++) {
		if (isBun) Bun.gc(true)
		else if (typeof globalThis.gc === 'function') globalThis.gc()
		else throw new Error('Node benchmark requires --expose-gc')
	}
}

const memorySnapshot = () => {
	forceGc()
	const processMemory = process.memoryUsage()

	if (isBun) {
		const heap = jsc.heapStats()
		return {
			heap: heap.heapSize,
			objects: heap.objectCount,
			extra: heap.extraMemorySize,
			...processMemory
		}
	}

	const heap = v8.getHeapStatistics()
	const code = v8.getHeapCodeStatistics()
	return {
		heap: heap.used_heap_size,
		heapTotal: heap.total_heap_size,
		malloced: heap.malloced_memory,
		externalV8: heap.external_memory,
		code: code.code_and_metadata_size,
		bytecode: code.bytecode_and_metadata_size,
		...processMemory
	}
}

const delta = (after, before) => {
	const out = {}
	for (const key in after)
		if (typeof after[key] === 'number' && typeof before[key] === 'number')
			out[key] = after[key] - before[key]
	return out
}

const sharedHandler = () => 'ok'

const make = (mode) => {
	const app = new Elysia()
	if (mode === 'construct') return app

	app.get('/program-id', sharedHandler)
	if (mode === 'build') void app.fetch
	else app.compile()

	return app
}

const child = () => {
	const mode = argument('mode', 'memory')
	const size = Number(
		argument('size', mode === 'construct' ? '10000' : '250')
	)

	if (!Number.isInteger(size) || size < 1)
		throw new Error(`invalid size: ${size}`)

	if (mode === 'semantics') {
		const a = new Elysia()
		const b = new Elysia()
		console.log(
			JSON.stringify({
				identityIsSelf: a['~programId'] === a,
				identitiesDistinct: a['~programId'] !== b['~programId'],
				own: Object.hasOwn(a, '~programId'),
				serialized: JSON.stringify(a)
			})
		)
		return
	}

	const warmup = mode === 'memory' || mode === 'construct' ? 100 : 20
	for (let i = 0; i < warmup; i++)
		make(mode === 'memory' ? 'construct' : mode)

	const before = memorySnapshot()
	const sink = new Array(size)
	const started = process.hrtime.bigint()
	for (let i = 0; i < size; i++)
		sink[i] = make(mode === 'memory' ? 'construct' : mode)
	const elapsedNs = Number(process.hrtime.bigint() - started)
	const after = memorySnapshot()

	globalThis.__programIdBenchmarkSink = sink
	console.log(
		JSON.stringify({
			mode,
			size,
			nsPerApp: elapsedNs / size,
			memory: delta(after, before)
		})
	)
}

const median = (values) => {
	const sorted = values.toSorted((a, b) => a - b)
	const middle = sorted.length >> 1
	return sorted.length & 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2
}

const runChild = (mode, size) => {
	const args = [
		...(isBun ? [] : ['--expose-gc']),
		file,
		'--child',
		`--mode=${mode}`,
		`--size=${size}`,
		...(useDist ? ['--dist'] : [])
	]
	const result = spawnSync(process.execPath, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	})

	if (result.status !== 0)
		throw new Error(
			`${mode}/${size} exited ${result.status}\n${result.stderr || result.stdout}`
		)

	return JSON.parse(result.stdout.trim())
}

const runner = () => {
	const sizes = [2_000, 10_000]
	const memory = new Map(sizes.map((size) => [size, []]))
	const timingModes = ['construct', 'build', 'compile']
	const timingSizes = { construct: 10_000, build: 250, compile: 250 }
	const timing = new Map(timingModes.map((mode) => [mode, []]))

	for (let repetition = 0; repetition < 5; repetition++) {
		for (const size of repetition & 1 ? sizes.toReversed() : sizes)
			memory.get(size).push(runChild('memory', size))

		for (const mode of repetition & 1
			? timingModes.toReversed()
			: timingModes)
			timing.get(mode).push(runChild(mode, timingSizes[mode]))
	}

	const low = sizes[0]
	const high = sizes[1]
	const memoryKeys = Object.keys(memory.get(low)[0].memory)
	const slopes = {}
	for (const key of memoryKeys)
		slopes[key] =
			(median(memory.get(high).map((sample) => sample.memory[key])) -
				median(memory.get(low).map((sample) => sample.memory[key]))) /
			(high - low)

	console.log(
		JSON.stringify(
			{
				runtime: isBun
					? `Bun ${Bun.version}`
					: `Node ${process.version}`,
				entry: useDist ? 'dist/index.mjs' : 'src/index.ts',
				repetitions: 5,
				memory: {
					sizes,
					slopesPerApp: slopes,
					samples: Object.fromEntries(memory)
				},
				timingNsPerApp: Object.fromEntries(
					timingModes.map((mode) => [
						mode,
						{
							median: median(
								timing
									.get(mode)
									.map((sample) => sample.nsPerApp)
							),
							samples: timing
								.get(mode)
								.map((sample) => sample.nsPerApp)
						}
					])
				),
				semantics: runChild('semantics', 1)
			},
			null,
			2
		)
	)
}

if (process.argv.includes('--child')) child()
else runner()
