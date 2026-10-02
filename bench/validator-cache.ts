// Plan 006: lazy content key in TypeBoxValidatorCache.
//
// Numbers (best-of-5, 4 interleaved A/B process runs, this machine,
// before/after `:zap: perf: lazy content key in validator cache`):
//
//   shared-schema (1 schema × 50 routes, construction + .compile()):
//     before ~1.445ms  →  after ~1.176ms  (-18.6%)
//   distinct-schemas (50 distinct schema literals, identity never hits):
//     before ~1.801ms  →  after ~1.815ms  (+0.8%, within noise)
//
// The model-cardinality diagnostic keeps 3,000 registry identities live while
// reporting the isolated cache population/clear deltas. It is directional,
// not a machine-specific byte gate.
//
// Run: `bun run bench/validator-cache.ts`

import { Elysia, t } from '../src'
import { TypeBoxValidatorCache } from '../src/type/validator'

const ROUTES = 50
const PROPS = 30
const RUNS = 5
const MODEL_REGISTRIES = 3_000

function makeSchema() {
	const props: Record<string, ReturnType<typeof t.String>> = {}
	for (let i = 0; i < PROPS; i++) props[`field${i}`] = t.String()
	return t.Object(props)
}

// a distinct, tiny response schema per route interleaves a *different*
// schema object between consecutive body-schema validator calls — this is
// what defeats the single-slot `#lastSchema` memo in route compilation and
// is what makes the identity-cache path (not the memo) matter in practice.
function makeResponseSchema(i: number) {
	return t.Object({ [`ok${i}`]: t.Boolean() })
}

function buildApp(schemaOf: (i: number) => ReturnType<typeof makeSchema>) {
	const app = new Elysia()
	for (let i = 0; i < ROUTES; i++)
		app.post(
			`/r${i}`,
			{
				body: schemaOf(i),
				response: makeResponseSchema(i)
			},
			() => 'ok'
		)
	return app
}

function timeOnce(schemaOf: (i: number) => ReturnType<typeof makeSchema>) {
	const start = Bun.nanoseconds()
	buildApp(schemaOf).compile()
	return Bun.nanoseconds() - start
}

function bestOf(
	label: string,
	schemaOf: (i: number) => ReturnType<typeof makeSchema>
) {
	// warmup
	for (let i = 0; i < 3; i++) timeOnce(schemaOf)

	const samples: number[] = []
	for (let i = 0; i < RUNS; i++) samples.push(timeOnce(schemaOf))

	const best = Math.min(...samples)
	const variance =
		(Math.max(...samples) - best) / best

	console.log(
		`${label}: best=${(best / 1e6).toFixed(3)}ms  samples(ms)=[${samples
			.map((s) => (s / 1e6).toFixed(3))
			.join(', ')}]  variance=${(variance * 100).toFixed(1)}%`
	)

	return best
}

function heapSnapshot() {
	for (let i = 0; i < 5; i++) Bun.gc(true)

	const { heapStats } = require('bun:jsc')
	const stats = heapStats()

	return {
		objectCount: stats.objectCount as number,
		heapSize: stats.heapSize as number,
		extraMemorySize: (stats.extraMemorySize ?? 0) as number
	}
}

function printHeap(label: string, snapshot: ReturnType<typeof heapSnapshot>) {
	console.log(
		`${label.padEnd(11)} objectCount=${snapshot.objectCount} heapSize=${snapshot.heapSize} extraMemorySize=${snapshot.extraMemorySize}`
	)
}

function modelCardinalityDiagnostic() {
	const schema = t.Refine(t.Object({ nested: t.Ref('Inner') }), () => true)
	const meta = TypeBoxValidatorCache.meta(schema)
	if (!meta.hasRef || !meta.special)
		throw new Error('model-cardinality schema must stay identity-only')

	const inner = t.Object({ value: t.Number() })
	const models = Array.from({ length: MODEL_REGISTRIES }, () => ({
		Inner: inner
	}))
	const cache = new TypeBoxValidatorCache(60_000)
	const before = heapSnapshot()

	for (let i = 0; i < models.length; i++)
		cache.set(schema, undefined, { tag: i } as any, '', models[i])

	const populated = heapSnapshot()
	cache.clear()
	const afterClear = heapSnapshot()

	console.log(
		`\nmodel-cardinality: 1 identity-only $ref schema × ${MODEL_REGISTRIES} live registries`
	)
	printHeap('before:', before)
	printHeap('populated:', populated)
	printHeap('after-clear:', afterClear)
	console.log(
		`cache delta  objectCount=${populated.objectCount - before.objectCount} heapSize=${populated.heapSize - before.heapSize} extraMemorySize=${populated.extraMemorySize - before.extraMemorySize}`
	)
	console.log(
		`clear delta  objectCount=${afterClear.objectCount - populated.objectCount} heapSize=${afterClear.heapSize - populated.heapSize} extraMemorySize=${afterClear.extraMemorySize - populated.extraMemorySize}`
	)

	// Keep every registry live through both post-population snapshots.
	if (models.length !== MODEL_REGISTRIES)
		throw new Error('registry keepalive lost')
}

console.log(`shared-schema: 1 schema × ${ROUTES} routes`)
const shared = makeSchema()
bestOf('shared-schema  ', () => shared)

console.log(`\ndistinct-schemas: ${ROUTES} distinct schema literals`)
bestOf('distinct-schemas', () => makeSchema())

modelCardinalityDiagnostic()
