const cases = {
	core: {
		limit: 250 * 1024,
		source: `import Elysia from './dist/index.mjs'; globalThis.app = new Elysia()`
	},
	schema: {
		limit: 560 * 1024,
		source: `import { Elysia, t } from './dist/index.mjs'; globalThis.app = new Elysia().get('/', { query: t.Object({ q: t.String() }) }, () => 'ok')`
	}
} as const

const baselineUrl = new URL('./bundle-size.baseline.json', import.meta.url)
const baselineFile = Bun.file(baselineUrl)
const baselineExists = await baselineFile.exists()
const shouldWriteBaseline = !baselineExists || !!process.env.UPDATE_BASELINE
const baseline: Record<string, number> = baselineExists
	? await baselineFile.json()
	: {}
const measured: Record<string, number> = {}

function printAttribution(metafile: Bun.BuildMetafile) {
	const groups: Record<string, number> = {}

	for (const [input, { bytesInOutput }] of Object.entries(
		Object.values(metafile.outputs)[0].inputs
	)) {
		let group = input

		const nodeModulesMatch = input.match(/^(?:.*\/)?node_modules\/([^/]+)/)
		const distMatch = input.match(/^(?:.*\/)?dist\/([^/]+)/)

		if (nodeModulesMatch) group = `node_modules/${nodeModulesMatch[1]}`
		else if (distMatch) group = `dist/${distMatch[1]}`

		groups[group] = (groups[group] ?? 0) + bytesInOutput
	}

	const sorted = Object.entries(groups).sort(([, a], [, b]) => b - a)

	for (const [group, bytes] of sorted.slice(0, 15))
		console.log(`${bytes}\t${group}`)
}

for (const [name, { limit, source }] of Object.entries(cases)) {
	const result = await Bun.build({
		entrypoints: ['./entry.js'],
		files: { './entry.js': source },
		target: 'node',
		format: 'esm',
		minify: true,
		metafile: true
	})

	if (!result.success)
		throw new AggregateError(result.logs, `${name} build failed`)

	const output = result.outputs[0]
	const raw = await output.arrayBuffer()
	console.log(`${name}: ${raw.byteLength} / ${limit} bytes`)

	const smoke = Bun.spawnSync({
		cmd: [
			process.execPath,
			'--eval',
			`import assert from 'node:assert/strict'
			await import('data:text/javascript;base64,' + Buffer.from(await Bun.stdin.arrayBuffer()).toString('base64'))
			const response = await globalThis.app.handle(new Request('http://localhost/?q=ok'))
			assert.equal(response.status, ${name === 'schema' ? 200 : 404})
			const body = await response.text()
			if (${name === 'schema'}) {
				assert.equal(body, 'ok')
				const invalid = await globalThis.app.handle(new Request('http://localhost/'))
				assert.equal(invalid.status, 422)
				await invalid.text()
			}`
		],
		stdin: new Uint8Array(raw),
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: process.cwd(),
		env: process.env,
		timeout: 10_000
	})

	if (!smoke.success)
		throw new Error(
			`${name} bundle smoke failed (exit ${smoke.exitCode}, signal ${smoke.signalCode ?? 'none'}, timeout ${!!smoke.exitedDueToTimeout}):\n${smoke.stderr.toString()}`
		)

	if (raw.byteLength > limit) {
		printAttribution(result.metafile!)

		throw new Error(
			`${name} bundle exceeds its ${limit}-byte budget (${raw.byteLength} bytes)`
		)
	}

	measured[name] = raw.byteLength

	if (!shouldWriteBaseline) {
		const base = baseline[name]
		const delta = raw.byteLength - base

		if (delta > 1024) {
			printAttribution(result.metafile!)

			throw new Error(
				`${name} grew ${delta} bytes over baseline (${raw.byteLength} vs ${base}). If intentional, rerun with UPDATE_BASELINE=1 and commit the baseline.`
			)
		}

		if (delta < -1024)
			console.log(
				`${name} shrank ${-delta} bytes under baseline (${raw.byteLength} vs ${base}). Consider rerunning with UPDATE_BASELINE=1 to update the baseline.`
			)
	}
}

if (shouldWriteBaseline) {
	await Bun.write(baselineUrl, JSON.stringify(measured, null, 2) + '\n')
	console.log('baseline updated')
}
