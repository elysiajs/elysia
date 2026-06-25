import { Elysia } from '../../src'
import { gc, memoryUsage } from './utils'

const total = 50_000

const variants: Record<string, () => any> = {
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
	}
}

const labels: Record<string, string> = {
	static: 'Static routes (/N)',
	'dynamic-default':
		'Dynamic (/N/:id) — default (Memoirist loosePath, 1 trie insert)',
	'dynamic-trailing-default':
		'Dynamic (/N/:id/) — default (Memoirist loosePath, 1 trie insert)',
	'dynamic-strict': 'Dynamic (/N/:id) — strictPath',
	'dynamic-trailing-strict': 'Dynamic (/N/:id/) — strictPath'
}

const which = process.argv[2]

if (which && variants[which]) {
	// Child: measure exactly one variant in a clean process.
	gc()
	const m1 = memoryUsage()

	const app = variants[which]()
	void app.fetch // trigger #buildRouter (lazy handlers, precompile off)

	gc()
	const delta = memoryUsage() - m1

	console.log(labels[which])
	console.log('  total    :', (delta / 1024 / 1024).toFixed(2), 'MB')
	console.log('  per route:', (delta / total).toFixed(1), 'bytes\n')

	void app // keep alive through measurement
} else {
	// Parent: spawn one clean child per variant.
	for (const name of Object.keys(variants)) {
		const proc = Bun.spawnSync({
			cmd: ['bun', 'run', import.meta.path, name],
			stdout: 'inherit',
			stderr: 'inherit'
		})
		if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
	}
}
