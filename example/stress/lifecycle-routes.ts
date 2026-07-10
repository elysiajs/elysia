import { Elysia } from '../../src'
import { environment, gc, median, profile } from './utils'

const build = (total: number) => {
	const plugins = new Array(total)

	for (let i = 0; i < total; i++)
		plugins[i] = new Elysia()
			.beforeHandle('plugin', () => {})
			.get(`/r${i}`, () => 'ok')

	const app = new Elysia()
	for (let i = 0; i < total; i++) app.use(plugins[i])

	return app
}

if (process.argv.includes('--scale')) {
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
	const stop = profile(
		'Elysia 2α full build 30k plugins w/ 1 route + global event then fetch\n'
	)
	const app = build(30_000)

	app.handle('/r0')

	stop()
}
