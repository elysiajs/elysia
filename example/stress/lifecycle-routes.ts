import { Elysia } from '../../src'
import { environment, gc, median, memorySnapshot, profile } from './utils'

const createPlugins = (total: number) => {
	const plugins = new Array(total)

	for (let i = 0; i < total; i++)
		plugins[i] = new Elysia()
			.beforeHandle('plugin', () => {})
			.get(`/r${i}`, () => 'ok')

	return plugins
}

const build = (total: number, plugins = createPlugins(total)) => {
	const app = new Elysia()
	for (let i = 0; i < total; i++) app.use(plugins[i])

	return app
}

const eagerSampleIndex = process.argv.indexOf('--eager-sample')

if (eagerSampleIndex !== -1) {
	const total = Number(process.argv[eagerSampleIndex + 1])
	const app = build(total)
	const before = memorySnapshot()
	const started = performance.now()
	;(app as any).compile()
	const timeMs = performance.now() - started
	const after = memorySnapshot()

	console.log(
		JSON.stringify({
			total,
			timeMs,
			memory: {
				before,
				after,
				currentDelta: after.current - before.current,
				objectDelta:
					'objectCount' in after && 'objectCount' in before
						? after.objectCount - before.objectCount
						: undefined
			}
		})
	)
} else if (process.argv.includes('--eager-scale')) {
	const sizes = [1_000, 2_000]
	const samples = new Map<
		number,
		Array<{
			timeMs: number
			memory: {
				before: ReturnType<typeof memorySnapshot>
				after: ReturnType<typeof memorySnapshot>
				currentDelta: number
				objectDelta?: number
			}
		}>
	>(sizes.map((size) => [size, []]))

	for (let repetition = 0; repetition < 5; repetition++)
		for (const size of repetition % 2 ? sizes.toReversed() : sizes) {
			const child = Bun.spawnSync({
				cmd: [
					process.execPath,
					import.meta.path,
					'--eager-sample',
					String(size),
					'--json'
				],
				stdout: 'pipe',
				stderr: 'inherit'
			})
			if (child.exitCode !== 0)
				throw new Error(`eager sample ${size} exited ${child.exitCode}`)

			const output = new TextDecoder().decode(child.stdout).trim()
			const line = output.split('\n').at(-1)
			if (!line)
				throw new Error(`eager sample ${size} produced no output`)
			samples.get(size)!.push(JSON.parse(line))
		}

	const mediansMs = sizes.map((size) =>
		median(samples.get(size)!.map((sample) => sample.timeMs))
	)
	const medianCurrentDelta = sizes.map((size) =>
		median(samples.get(size)!.map((sample) => sample.memory.currentDelta))
	)
	const medianObjectDelta = sizes.map((size) =>
		median(
			samples
				.get(size)!
				.map((sample) => sample.memory.objectDelta)
				.filter((value): value is number => value !== undefined)
		)
	)
	const ratio = mediansMs[1]! / mediansMs[0]!
	const result = {
		runtime: `Bun ${Bun.version}`,
		environment: environment(),
		sizes,
		repetitions: 5,
		mediansMs,
		ratio,
		memory: {
			metric: samples.get(sizes[0])![0]!.memory.after.metric,
			medianCurrentDelta,
			medianObjectDelta,
			samples: sizes.map((size) =>
				samples.get(size)!.map((sample) => sample.memory)
			)
		},
		pass: ratio < 2.75
	}

	if (process.argv.includes('--json')) console.log(JSON.stringify(result))
	else console.log(result)

	if (!result.pass) process.exitCode = 1
} else if (process.argv.includes('--scale')) {
	const sizes = [10_000, 20_000]
	const samples = new Map(sizes.map((size) => [size, [] as number[]]))

	for (let repetition = 0; repetition < 5; repetition++)
		for (const size of repetition % 2 ? sizes.toReversed() : sizes) {
			const app = build(size)
			gc()

			const started = performance.now()
			void app.fetch
			samples.get(size)!.push(performance.now() - started)
		}

	const medians = sizes.map((size) => median(samples.get(size)!))
	const ratio = medians[1]! / medians[0]!
	const result = {
		runtime: `Bun ${Bun.version}`,
		environment: environment(),
		sizes,
		repetitions: 5,
		mediansMs: medians,
		ratio,
		pass: ratio < 2.75
	}

	if (process.argv.includes('--json')) console.log(JSON.stringify(result))
	else console.log(result)

	if (!result.pass) process.exitCode = 1
} else {
	// plugin construction hoisted out of the timed window so the number
	// isolates absorption + build, not instance creation
	const plugins = createPlugins(30_000)

	const stop = profile(
		'Elysia 2α full build 30k plugins w/ 1 route + global event then fetch\n'
	)
	const app = build(30_000, plugins)

	app.fetch

	stop()
}
