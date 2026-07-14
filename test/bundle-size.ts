const cases = {
	core: {
		limit: 250 * 1024,
		source: `import Elysia from './dist/index.mjs'; globalThis.app = new Elysia()`,
		resume: false
	},
	schema: {
		// The optional B2 resume entry keeps default apps under the original 400KB
		// budget. Remaining semantic-seal additions (maintainer sign-off pending):
		//  - B7 columnar route table (src/route-table.ts): ~640B net (offset by
		//    deduping schemaMediaKind out of the resume emitter).
		//  - B6 semantic freeze (src/generation.ts + Q4 guards in base.ts):
		//    ~1.4KB. Load-bearing seal machinery, not removable.
		//  - C3 lazy signed-cookie verify (Q8): ~530B. resolvePendingCookie +
		//    parseCookieRawLazy, statically imported by the Cookie class + handler
		//    compiler (dormant unless a route runs the required-fields lazy lane).
		//    Same lazy-registry follow-up could tree-shake it from cookie-free apps.
		limit: 400 * 1024,
		source: `import { Elysia, t } from './dist/index.mjs'; globalThis.app = new Elysia().get('/', () => 'ok', { query: t.Object({ q: t.String() }) })`,
		resume: false
	},
	resume: {
		// Preview users retain both resume and legacy for route-level fallback.
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
