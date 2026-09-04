import { resolve } from 'node:path'

// D1 fixture — B5 experimental.lazyCompose build-cost grid.
//
// WHAT THIS MEASURES
// CONSTRUCTION+BUILD cost of a nested Elysia chain: construct `depth` instances
// where each level `.use`s the accumulated child then adds its own share of
// routes (the reabsorption stress shape), then force the route table to build by
// touching `.routes`. Two modes per cell, built from the SAME builder:
//   - eager: the current O(N·D²) `.use` re-absorption path
//   - lazy:  experimental.lazyCompose — defer the per-route copy loop into an
//            ordered `route | use` plan, single-pass DFS flatten at build
// over the grid depth {1,16,64,256} × routes-per-chain {1,100,1000,10000},
// routes distributed ~evenly across levels (max(1, round(routes/depth)) each).
//
// WHY THIS IS A STANDALONE FIXTURE, NOT WIRED INTO record/aa/gate
// The D1 record/aa/gate machinery compares two Elysia *roots* (baseline commit
// vs candidate commit, swapped via D1_ELYSIA_ROOT worktrees) and extracts ONE
// scalar per metric from a --routes=1000 child (see run.ts rawMetricSamples).
// lazy-vs-eager is a *flag toggle within a single commit*, over a *grid* — it
// fits neither the two-root A/B axis nor the scalar-per-metric shape. Forcing it
// into fixtureIds would run it as a baseline-vs-candidate comparison of the SAME
// code on both sides (a meaningless A/A) and rawMetricSamples cannot read a grid.
// So both modes run INTERLEAVED inside this one child, the doc carries the full
// grid + per-cell lazy/eager ratio, and the sub-linear-vs-superlinear ASSERTION
// lives in a plain `bun test` (test/core/lazy-compose-slope.test.ts). This is the
// escape hatch design/n-proof.md anticipates for metrics the two-root gate
// comparator cannot express.
//
// WHY NO margins.json ENTRY. A margins.json entry is consumed by verify's
// completeness check (run.ts ~1589): every registered (fixture, metric) MUST
// appear in the recorded baseline. record-mode only runs the six two-root
// fixtureIds, so it would never produce a compose-depth record — a compose-depth
// margin makes verify throw `baseline is missing compose-depth/...`. Registering
// it would require either fabricating baseline records or rebuilding the
// grid-unaware extraction/gate machinery, both out of scope for a fixture add.
// Empirically confirmed. Hence: NO margins entry; the slope gate is the bun test.
//
// PENDING-AC (machine is on battery; record/aa/gate preflight-pin AC power and
// refuse to run). Adding this file to BENCH_SOURCE_FILES (env.ts) changes
// benchSourceHash. The committed tree does NOT ship a baseline or raw run
// artifacts; both bench/d1/baseline/ and bench/d1/runs/ are gitignored. The
// local baseline dir on the pinned machine was re-stamped to the new hash (a
// LOCAL, git-untracked bridge, exactly what record-mode's manifest refresh does
// at run.ts ~1051 —
// re-stamp the hash without re-taking samples, since compose-depth is never
// exercised by a recording). On return to AC, re-pin + re-record so a real
// artifact re-establishes provenance for the six gated fixtures:
//   bun run bench/d1/run.ts aa                # >=3 sessions -> floors.json
//   bun run bench/d1/run.ts record --promote  # fresh local baseline + manifest
//   bun run bench:d1:selftest                 # 5 injected classes fail
//   bun run bench:d1:gate                     # active margins vs baseline
// compose-depth itself is validated by RUNNING IT STANDALONE (below) + the bun
// test; it needs no AC step.

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

// A single eager sample slower than this prunes the cell (spec: ~2s). Kept below
// 2s so the probe itself never blows the harness's 120s child timeout budget.
const PRUNE_MS = 2_000

const DEPTHS = [1, 16, 64, 256] as const
const ROUTE_TOTALS = [1, 100, 1_000, 10_000] as const

type Opt = Record<string, unknown>
const eagerOpt = (): Opt => ({})
const lazyOpt = (): Opt => ({ experimental: { lazyCompose: true } })

interface Grid {
	Elysia: any
}

// Build a chain of `depth` instances. Each level constructs a fresh instance,
// `.use`s the accumulated child, then registers its share of routes. Touching
// `.routes` at the end forces the deferred/eager table to build. Returns the
// realized route count so the doc can prove both modes produced the same table.
function buildChain(
	Elysia: any,
	depth: number,
	perLevel: number,
	opt: Opt
): number {
	let node: any = new Elysia(opt)
	// Seed the innermost node with its own routes so depth-1 still has routes.
	for (let r = 0; r < perLevel; r++)
		node = node.get(`/seed${r}`, () => r)
	for (let d = 1; d < depth; d++) {
		let parent: any = new Elysia({ prefix: `/l${d}`, ...opt })
		parent = parent.use(node)
		for (let r = 0; r < perLevel; r++)
			parent = parent.get(`/own${d}_${r}`, () => r)
		node = parent
	}
	return node.routes.length as number
}

function perLevelFor(depth: number, routes: number) {
	return Math.max(1, Math.round(routes / depth))
}

function median(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = sorted.length >> 1
	return sorted.length % 2
		? sorted[mid]!
		: (sorted[mid - 1]! + sorted[mid]!) / 2
}

interface CellResult {
	depth: number
	routes: number
	perLevel: number
	pruned: boolean
	// present iff !pruned
	realizedRoutes?: number
	eagerSamples?: number[]
	lazySamples?: number[]
	eagerMedianMs?: number
	lazyMedianMs?: number
	ratio?: number
	// present iff pruned
	probeMs?: number
	pruneThresholdMs?: number
}

function measureCell(
	grid: Grid,
	depth: number,
	routes: number,
	iterations: number
): CellResult {
	const { Elysia } = grid
	const perLevel = perLevelFor(depth, routes)

	// Probe: one eager build. If a single eager sample already exceeds the prune
	// threshold this cell is pathological (e.g. depth 256 × 10k) — record the
	// pruning EXPLICITLY rather than burning multi-second samples silently.
	const probe0 = performance.now()
	const realizedRoutes = buildChain(Elysia, depth, perLevel, eagerOpt())
	const probeMs = performance.now() - probe0
	if (probeMs > PRUNE_MS)
		return {
			depth,
			routes,
			perLevel,
			pruned: true,
			probeMs,
			pruneThresholdMs: PRUNE_MS
		}

	// Warm both codepaths once so timed samples exclude first-call JIT.
	buildChain(Elysia, depth, perLevel, eagerOpt())
	buildChain(Elysia, depth, perLevel, lazyOpt())

	// Interleave A/B (eager/lazy) per iteration so drift/thermal noise hits both
	// modes symmetrically — the same discipline the harness uses for paired blocks.
	const eagerSamples: number[] = []
	const lazySamples: number[] = []
	for (let i = 0; i < iterations; i++) {
		const e0 = performance.now()
		buildChain(Elysia, depth, perLevel, eagerOpt())
		eagerSamples.push(performance.now() - e0)
		const l0 = performance.now()
		buildChain(Elysia, depth, perLevel, lazyOpt())
		lazySamples.push(performance.now() - l0)
	}

	const eagerMedianMs = median(eagerSamples)
	const lazyMedianMs = median(lazySamples)
	return {
		depth,
		routes,
		perLevel,
		pruned: false,
		realizedRoutes,
		eagerSamples,
		lazySamples,
		eagerMedianMs,
		lazyMedianMs,
		ratio: eagerMedianMs === 0 ? 0 : lazyMedianMs / eagerMedianMs
	}
}

function iterationsFor(depth: number, routes: number) {
	// Cheap cells get many samples; expensive ones fewer to stay well inside the
	// child timeout. Cost grows with both depth (D²) and routes.
	const cost = depth * Math.max(1, routes)
	if (cost <= 1_000) return 25
	if (cost <= 100_000) return 11
	if (cost <= 2_000_000) return 7
	return 5
}

// parked: lazyCompose lane dropped pre-N+1; re-lands with the N+3a authoring DAG — see design/necessity-audit-2026-07-17.md
const PARKED = true

async function main() {
	if (PARKED) {
		console.log(
			JSON.stringify({
				fixture: 'compose-depth',
				schemaVersion: 1,
				mode: 'parked',
				parked: true
			})
		)
		return
	}

	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const grid: Grid = { Elysia }

	const cells: CellResult[] = []
	for (const routes of ROUTE_TOTALS)
		for (const depth of DEPTHS)
			cells.push(
				measureCell(grid, depth, routes, iterationsFor(depth, routes))
			)

	// Headline gate cells (routes=1000): the depth-256 ratio + the slope classes.
	const at = (depth: number, routes: number) =>
		cells.find((c) => c.depth === depth && c.routes === routes)
	const headlineRoutes = 1_000
	const d16 = at(16, headlineRoutes)
	const d64 = at(64, headlineRoutes)
	const d256 = at(256, headlineRoutes)

	const slope = (
		hi: CellResult | undefined,
		lo: CellResult | undefined,
		pick: (c: CellResult) => number | undefined
	) => {
		const h = hi && !hi.pruned ? pick(hi) : undefined
		const l = lo && !lo.pruned ? pick(lo) : undefined
		if (h === undefined || l === undefined || !l) return null
		return h / l
	}

	const headline = {
		routes: headlineRoutes,
		lazyEagerRatioAtDepth256:
			d256 && !d256.pruned ? (d256.ratio ?? null) : null,
		lazyEagerRatioAtDepth64:
			d64 && !d64.pruned ? (d64.ratio ?? null) : null,
		// slope class: cost(d256)/cost(d16) for each mode. Eager superlinear,
		// lazy sub-linear — the whole point of the flag.
		eagerSlope256over16: slope(d256, d16, (c) => c.eagerMedianMs),
		lazySlope256over16: slope(d256, d16, (c) => c.lazyMedianMs),
		eagerSlope64over16: slope(d64, d16, (c) => c.eagerMedianMs),
		lazySlope64over16: slope(d64, d16, (c) => c.lazyMedianMs)
	}

	console.log(
		JSON.stringify({
			fixture: 'compose-depth',
			schemaVersion: 1,
			mode: 'standalone-grid',
			grid: { depths: DEPTHS, routeTotals: ROUTE_TOTALS },
			pruneThresholdMs: PRUNE_MS,
			cells,
			headline,
			routeSizeOrder: [...ROUTE_TOTALS]
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
