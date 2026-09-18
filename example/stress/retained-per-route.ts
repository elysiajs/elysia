import { Elysia } from '../../src'
import { environment, memorySnapshot } from './utils'

const total = 50_000
const ownerTotal = 20_000
const json = process.argv.includes('--json')

const variants: Record<string, () => Elysia<any, any>> = {
	static: () => {
		const app = new Elysia()
		for (let i = 0; i < total; i++) app.get(`/${i}`, () => 'ok')
		return app
	},
	'dynamic-default': () => {
		const app = new Elysia()
		for (let i = 0; i < total; i++) app.get(`/${i}/:id`, () => 'ok')
		return app
	},
	'dynamic-trailing-default': () => {
		const app = new Elysia()
		for (let i = 0; i < total; i++) app.get(`/${i}/:id/`, () => 'ok')
		return app
	},
	'dynamic-strict': () => {
		const app = new Elysia({ strictPath: true })
		for (let i = 0; i < total; i++) app.get(`/${i}/:id`, () => 'ok')
		return app
	},
	'dynamic-trailing-strict': () => {
		const app = new Elysia({ strictPath: true })
		for (let i = 0; i < total; i++) app.get(`/${i}/:id/`, () => 'ok')
		return app
	},
	'direct-owner': () => {
		const app = new Elysia()
		for (let i = 0; i < ownerTotal; i++) app.get(`/owner/${i}`, () => 'ok')
		return app
	},
	'absorbed-plugin-owner': () => {
		const app = new Elysia()
		for (let i = 0; i < ownerTotal; i++)
			app.use(new Elysia().get(`/owner/${i}`, () => 'ok'))
		return app
	}
}

const labels: Record<string, string> = {
	static: 'Static routes (/N)',
	'dynamic-default':
		'Dynamic (/N/:id) — default (Memoirist loosePath, 1 trie insert)',
	'dynamic-trailing-default':
		'Dynamic (/N/:id/) — default (Memoirist loosePath, 1 trie insert)',
	'dynamic-strict': 'Dynamic (/N/:id) — strictPath',
	'dynamic-trailing-strict': 'Dynamic (/N/:id/) — strictPath',
	'direct-owner': 'Direct plain route owners',
	'absorbed-plugin-owner': 'Discarded one-route plain plugin owners'
}

const which = process.argv.find((argument) => variants[argument])

if (which) {
	const routeTotal =
		which === 'direct-owner' || which === 'absorbed-plugin-owner'
			? ownerTotal
			: total
	const before = memorySnapshot()
	const app = variants[which]!()
	void app.fetch
	const after = memorySnapshot()
	const currentDelta = after.current - before.current
	const objectCountDelta =
		'objectCount' in after && 'objectCount' in before
			? after.objectCount - before.objectCount
			: undefined
	const result = {
		name: which,
		label: labels[which],
		total: routeTotal,
		metric: after.metric,
		before,
		after,
		currentMetric: after.metric,
		currentDelta,
		objectCountMetric:
			objectCountDelta === undefined ? undefined : 'bun:jsc.objectCount',
		objectCountDelta,
		bytesPerRoute: currentDelta / routeTotal,
		environment: environment()
	}

	if (json) console.log(JSON.stringify(result))
	else {
		console.log(result.label)
		console.log(
			`  ${result.currentMetric}:`,
			(currentDelta / 1024 / 1024).toFixed(2),
			'MB'
		)
		if (objectCountDelta !== undefined)
			console.log(`  ${result.objectCountMetric}:`, objectCountDelta)
		console.log('  per route:', result.bytesPerRoute.toFixed(1), 'bytes\n')
	}

	void app
} else {
	const results: unknown[] = []

	for (const name of Object.keys(variants)) {
		const child = Bun.spawnSync({
			cmd: [
				process.execPath,
				'run',
				import.meta.path,
				name,
				...(json ? ['--json'] : [])
			],
			stdout: json ? 'pipe' : 'inherit',
			stderr: 'inherit'
		})

		if (child.exitCode !== 0) process.exit(child.exitCode ?? 1)
		if (json)
			results.push(
				JSON.parse(new TextDecoder().decode(child.stdout).trim())
			)
	}

	if (json)
		console.log(
			JSON.stringify({
				kind: 'retained-per-route',
				environment: environment(),
				total,
				variants: results
			})
		)
}
