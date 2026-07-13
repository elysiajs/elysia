const cases = {
	core: {
		limit: 250 * 1024,
		source: `import Elysia from './dist/index.mjs'; globalThis.app = new Elysia()`
	},
	schema: {
		// Bumped 400→406→408KB across the semantic-seal + major-surface trains
		// (maintainer sign-off pending — itemized):
		//  - B2 resume-emit lane (src/compile/plan/*): ~10KB. Statically imported
		//    by the handler compiler, so every app pays for the dormant preview
		//    lane. Follow-up sketched: lazy-registry install (AOT captureImpl
		//    pattern) so emit.ts/plan.ts tree-shake out → recovers most of this.
		//  - B7 columnar route table (src/route-table.ts): ~640B net (offset by
		//    deduping schemaMediaKind out of the resume emitter).
		//  - B6 semantic freeze (src/generation.ts + Q4 guards in base.ts):
		//    ~1.4KB. Load-bearing seal machinery, not removable.
		//  - C3 lazy signed-cookie verify (Q8): ~530B. resolvePendingCookie +
		//    parseCookieRawLazy, statically imported by the Cookie class + handler
		//    compiler (dormant unless a route runs the required-fields lazy lane).
		//    Same lazy-registry follow-up could tree-shake it from cookie-free apps.
		limit: 408 * 1024,
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
	console.log(`${name}: ${raw.byteLength} / ${limit} bytes`)

	if (raw.byteLength > limit)
		throw new Error(`${name} bundle exceeds its ${limit}-byte budget (${raw.byteLength} bytes)`)
}
