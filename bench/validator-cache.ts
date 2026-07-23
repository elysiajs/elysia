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
// Run: `bun run bench/validator-cache.ts`

import { Elysia, t } from '../src'

const ROUTES = 50
const PROPS = 30
const RUNS = 5

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

console.log(`shared-schema: 1 schema × ${ROUTES} routes`)
const shared = makeSchema()
bestOf('shared-schema  ', () => shared)

console.log(`\ndistinct-schemas: ${ROUTES} distinct schema literals`)
bestOf('distinct-schemas', () => makeSchema())
