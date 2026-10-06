import { heapStats, memoryUsage } from 'bun:jsc'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { environment } from './utils'

// Memory a compiled route keeps alive, per route shape, across Elysia builds.
// Each (target, shape) runs in its own child: a warm-up app absorbs one-time
// module and codegen cost, then apps A and B of N routes are built and every
// route is handled once. Per-route = (after B - after A) / N, so fixed costs
// cancel. heapStats().heapSize is the GC heap (objects, indexed storage, scopes)
// and repeats to a few bytes; memoryUsage().current is the process allocator,
// which adds native memory such as bytecode but also allocator slack, so it
// runs higher and moves by a few hundred bytes between runs.

const { values } = parseArgs({
	options: {
		target: { type: 'string', multiple: true, default: ['src'] },
		shape: { type: 'string', multiple: true },
		n: { type: 'string', default: '10000' },
		json: { type: 'boolean', default: false },
		child: { type: 'string' }
	}
})
const n = Number(values.n)

if (values.child) {
	const { Elysia, t } = await import(values.child)
	const legacy = typeof Elysia.prototype.onBeforeHandle === 'function'

	const get = (app: any, path: string, handler: Function, hook?: object) =>
		hook === undefined
			? app.get(path, handler)
			: legacy
				? app.get(path, handler, hook)
				: app.get(path, hook, handler)

	const routes = (app: any, add: (app: any, path: string) => void) => {
		for (let i = 0; i < n; i++) add(app, `/${i}`)
		return app
	}

	const shapes: Record<string, () => any> = {
		plain: () =>
			routes(new Elysia(), (app, path) => get(app, path, () => 'hi')),
		set: () =>
			routes(new Elysia(), (app, path) =>
				get(app, path, ({ set }: any) => {
					set.headers['x-a'] = '1'
					return 'hi'
				})
			),
		'default-headers': () =>
			routes(
				new Elysia().headers({ 'x-powered-by': 'Elysia' }),
				(app, path) => get(app, path, () => 'hi')
			),
		response: () =>
			routes(new Elysia(), (app, path) =>
				get(app, path, () => 'hi', { response: t.String() })
			),
		'response-map': () =>
			routes(new Elysia(), (app, path) =>
				get(app, path, () => 'hi', {
					response: { 200: t.String(), 404: t.String() }
				})
			),
		'shared-guard': () =>
			new Elysia().guard(
				{ response: { 401: t.String(), 403: t.String() } },
				(guard: any) =>
					routes(guard, (app, path) =>
						get(app, path, () => 'hi', { response: t.String() })
					)
			)
	}

	const shape = values.shape![0]!
	const keep: any[] = []

	const build = async () => {
		const app = shapes[shape]!()
		for (let i = 0; i < n; i++) {
			const response = await app.handle(
				new Request(`http://localhost/${i}`)
			)
			if (response.status !== 200)
				throw new Error(
					`${shape} /${i}: ${response.status} ${await response.text()}`
				)
		}
		keep.push(app)
	}

	const sample = async () => {
		for (let i = 0; i < 3; i++) {
			Bun.gc(true)
			await Bun.sleep(10)
		}
		const heap = heapStats()
		return {
			current: memoryUsage().current,
			heapSize: heap.heapSize,
			objectCount: heap.objectCount,
			scopes: heap.objectTypeCounts.JSLexicalEnvironment ?? 0
		}
	}

	await build()
	await build()
	const a = await sample()
	await build()
	const b = await sample()

	console.log(
		JSON.stringify({
			legacy,
			apps: keep.length,
			afterA: a,
			afterB: b,
			perRoute: {
				current: (b.current - a.current) / n,
				heapSize: (b.heapSize - a.heapSize) / n,
				objectCount: (b.objectCount - a.objectCount) / n,
				scopes: (b.scopes - a.scopes) / n
			}
		})
	)
} else {
	const entryOf = (target: string) => {
		if (target === 'src')
			return resolve(import.meta.dir, '../../src/index.ts')
		if (existsSync(target)) return resolve(target)

		const dir = join(tmpdir(), 'elysia-stress-targets', target)
		if (!existsSync(join(dir, 'node_modules', 'elysia'))) {
			mkdirSync(dir, { recursive: true })
			if (!existsSync(join(dir, 'package.json')))
				writeFileSync(join(dir, 'package.json'), '{ "private": true }')

			const install = Bun.spawnSync({
				cmd: [process.execPath, 'add', target],
				cwd: dir,
				stdout: 'ignore',
				stderr: 'inherit'
			})
			if (install.exitCode !== 0)
				throw new Error(`bun add ${target} failed in ${dir}`)
		}

		return Bun.resolveSync('elysia', dir)
	}

	const versionOf = (entry: string) => {
		for (
			let dir = dirname(entry);
			dir !== dirname(dir);
			dir = dirname(dir)
		) {
			const file = join(dir, 'package.json')
			if (!existsSync(file)) continue

			const pkg = JSON.parse(readFileSync(file, 'utf8'))
			if (pkg.name === 'elysia') return pkg.version as string
		}
	}

	const shapes = values.shape ?? [
		'plain',
		'set',
		'default-headers',
		'response',
		'response-map',
		'shared-guard'
	]
	const targets = values.target!.map((target) => {
		const entry = entryOf(target)
		return { target, entry, version: versionOf(entry) }
	})
	const results: any[] = []

	for (const { target, entry } of targets)
		for (const shape of shapes) {
			const child = Bun.spawnSync({
				cmd: [
					process.execPath,
					import.meta.path,
					'--child',
					entry,
					'--shape',
					shape,
					'--n',
					String(n)
				],
				env: { ...process.env, NODE_ENV: 'production' },
				stdout: 'pipe',
				stderr: 'inherit'
			})
			if (child.exitCode !== 0) {
				console.error(
					`${target} ${shape}: child exited ${child.exitCode}`
				)
				process.exit(child.exitCode ?? 1)
			}

			results.push({
				target,
				shape,
				...JSON.parse(child.stdout.toString())
			})
		}

	if (values.json)
		console.log(
			JSON.stringify({
				kind: 'retained-compiled-route',
				environment: environment(),
				n,
				targets,
				results
			})
		)
	else {
		const labels = targets.map(({ target, version }) =>
			version && !target.includes(version)
				? `${target} (${version})`
				: target
		)
		const width = Math.max(22, ...labels.map((label) => label.length))

		console.log(
			`N=${n}, per route: heapSize B / memoryUsage().current B / JSLexicalEnvironment\n`
		)
		console.log(
			'shape'.padEnd(16) +
				labels.map((label) => label.padStart(width + 2)).join('')
		)
		for (const shape of shapes)
			console.log(
				shape.padEnd(16) +
					results
						.filter((result) => result.shape === shape)
						.map(({ perRoute }) =>
							`${perRoute.heapSize.toFixed(0)} / ${perRoute.current.toFixed(0)} / ${perRoute.scopes.toFixed(2)}`.padStart(
								width + 2
							)
						)
						.join('')
			)
	}
}
