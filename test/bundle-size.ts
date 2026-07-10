import { gzipSync } from 'node:zlib'

const cases = {
	core: {
		limit: 60 * 1024,
		source: `import Elysia from './dist/index.mjs'; globalThis.app = new Elysia()`
	},
	schema: {
		limit: 115 * 1024,
		source: `import { Elysia, t } from './dist/index.mjs'; globalThis.app = new Elysia().get('/', () => 'ok', { query: t.Object({ q: t.String() }) })`
	}
} as const

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

	const raw = await result.outputs[0].arrayBuffer()
	const gzip = gzipSync(raw, { level: 9 }).byteLength
	console.log(`${name}: ${gzip} / ${limit} bytes gzip`)

	if (gzip > limit)
		throw new Error(`${name} bundle exceeds its ${limit}-byte gzip budget`)
}
