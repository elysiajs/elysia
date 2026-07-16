const cases = {
	core: {
		limit: 250 * 1024,
		source: `import Elysia from './dist/index.mjs'; globalThis.app = new Elysia()`,
		resume: false
	},
	schema: {
		limit: 400 * 1024,
		source: `import { Elysia, t } from './dist/index.mjs'; globalThis.app = new Elysia().get('/', () => 'ok', { query: t.Object({ q: t.String() }) })`,
		resume: false
	},
	resume: {
		limit: 410 * 1024,
		source: `import { Elysia, t } from './dist/index.mjs'; import { resumeEmit } from './dist/experimental/resume.mjs'; globalThis.app = new Elysia({ experimental: { resumeEmit } }).get('/', () => 'ok', { query: t.Object({ q: t.String() }) })`,
		resume: true
	}
} as const

for (const [name, { limit, source, resume }] of Object.entries(cases)) {
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

	if (raw.byteLength > limit)
		throw new Error(
			`${name} bundle exceeds its ${limit}-byte budget (${raw.byteLength} bytes)`
		)

	const hasResume = new TextDecoder()
		.decode(raw)
		.includes('__resume(c,pc,pending')
	if (hasResume !== resume)
		throw new Error(
			`${name} bundle ${hasResume ? 'unexpectedly includes' : 'does not include'} the resume emitter`
		)
}
