const cases = {
	core: {
		limit: 250 * 1024,
		source: `import Elysia from './dist/index.mjs'; globalThis.app = new Elysia()`
	},
	schema: {
		limit: 400 * 1024,
		source: `import { Elysia, t } from './dist/index.mjs'; globalThis.app = new Elysia().get('/', () => 'ok', { query: t.Object({ q: t.String() }) })`
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

async function printAttribution(source: string) {
	const esbuild = await import('esbuild')

	const { metafile } = await esbuild.build({
		stdin: {
			contents: source,
			resolveDir: process.cwd(),
			loader: 'js'
		},
		bundle: true,
		minify: true,
		format: 'esm',
		platform: 'node',
		write: false,
		metafile: true,
		outfile: 'out.js',
		logLevel: 'silent'
	})

	const groups: Record<string, number> = {}

	for (const [input, { bytesInOutput }] of Object.entries(
		metafile.outputs['out.js'].inputs
	)) {
		let group = input

		const nodeModulesMatch = input.match(/^(?:.*\/)?node_modules\/([^/]+)/)
		const distMatch = input.match(/^(?:.*\/)?dist\/([^/]+)/)

		if (nodeModulesMatch) group = `node_modules/${nodeModulesMatch[1]}`
		else if (distMatch) group = `dist/${distMatch[1]}`

		groups[group] = (groups[group] ?? 0) + bytesInOutput
	}

	const sorted = Object.entries(groups).sort(([, a], [, b]) => b - a)

	console.log(
		'(esbuild attribution below is an approximation of the Bun total)'
	)

	for (const [group, bytes] of sorted.slice(0, 15))
		console.log(`${bytes}\t${group}`)
}

for (const [name, { limit, source }] of Object.entries(cases)) {
	const result = await Bun.build({
		entrypoints: ['virtual:entry'],
		target: 'node',
		format: 'esm',
		minify: true,
		plugins: [
			{
				name: 'virtual-entry',
				setup(build) {
					build.onResolve({ filter: /^virtual:entry$/ }, () => ({
						path: 'entry',
						namespace: 'bundle-size'
					}))
					build.onLoad(
						{ filter: /.*/, namespace: 'bundle-size' },
						() => ({
							contents: source,
							loader: 'js',
							resolveDir: process.cwd()
						})
					)
				}
			}
		]
	})

	if (!result.success)
		throw new AggregateError(result.logs, `${name} build failed`)

	const output = result.outputs[0]
	const raw = await output.arrayBuffer()
	console.log(`${name}: ${raw.byteLength} / ${limit} bytes`)

	if (raw.byteLength > limit) {
		await printAttribution(source)

		throw new Error(
			`${name} bundle exceeds its ${limit}-byte budget (${raw.byteLength} bytes)`
		)
	}

	measured[name] = raw.byteLength

	if (!shouldWriteBaseline) {
		const base = baseline[name]
		const delta = raw.byteLength - base

		if (delta > 1024) {
			await printAttribution(source)

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
