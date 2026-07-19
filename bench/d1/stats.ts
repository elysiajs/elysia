import type {
	ComparisonResult,
	MetricClaim,
	MetricDirection,
	MetricKind,
	Verdict
} from './schema'

export interface MetricSummary {
	median: number
	p95: number
	p99: number
	mad: number
}

export interface BootstrapCI {
	medianDelta: number
	low: number
	high: number
	width: number
	resamples: number
	seed: number
}

export interface CompareInput {
	fixture: string
	metric: string
	kind: MetricKind
	direction: MetricDirection
	claim?: MetricClaim
	margin: number
	tolerance?: number
	baselineBlocks: number[]
	candidateBlocks: number[]
	seed: number
	resamples?: number
}

export function median(values: number[]): number {
	if (!values.length) throw new Error('median requires at least one value')
	const sorted = values.slice().sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2
		? sorted[middle]!
		: (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function lowerMedian(values: number[]): number {
	if (!values.length)
		throw new Error('lowerMedian requires at least one value')
	const sorted = values.slice().sort((a, b) => a - b)
	return sorted[Math.floor((sorted.length - 1) / 2)]!
}

export function percentile(values: number[], percent: number): number {
	if (!values.length)
		throw new Error('percentile requires at least one value')
	if (percent < 0 || percent > 100)
		throw new Error(`invalid percentile: ${percent}`)
	const sorted = values.slice().sort((a, b) => a - b)
	const position = (sorted.length - 1) * (percent / 100)
	const lower = Math.floor(position)
	const upper = Math.ceil(position)
	if (lower === upper) return sorted[lower]!
	return (
		sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
	)
}

export function p95(values: number[]) {
	return percentile(values, 95)
}

export function p99(values: number[]) {
	return percentile(values, 99)
}

export function mad(values: number[]): number {
	const middle = median(values)
	return median(values.map((value) => Math.abs(value - middle)))
}

export function summarize(values: number[], discrete = false): MetricSummary {
	const aggregate = discrete ? lowerMedian : median
	const percentile_ = discrete
		? (percent: number) =>
				values.slice().sort((a, b) => a - b)[
					Math.ceil((percent / 100) * values.length) - 1
				]!
		: (percent: number) => percentile(values, percent)
	const middle = aggregate(values)
	return {
		median: middle,
		p95: percentile_(95),
		p99: percentile_(99),
		mad: aggregate(values.map((value) => Math.abs(value - middle)))
	}
}

export function seededPrng(seed: number) {
	let state = seed >>> 0
	if (state === 0) throw new Error('PRNG seed must be nonzero')
	return () => {
		state ^= state << 13
		state ^= state >>> 17
		state ^= state << 5
		return (state >>> 0) / 0x100000000
	}
}

export function bootstrapRelativeMedianDelta(
	baselineBlocks: number[],
	candidateBlocks: number[],
	seed: number,
	resamples = 2_000
): BootstrapCI {
	if (baselineBlocks.length !== candidateBlocks.length)
		throw new Error('paired bootstrap requires equal block counts')
	if (baselineBlocks.length < 2)
		throw new Error('paired bootstrap requires at least two blocks')
	if (resamples < 2_000)
		throw new Error('paired bootstrap requires at least 2000 resamples')
	const baseline = median(baselineBlocks)
	if (baseline === 0)
		throw new Error('relative comparison cannot use a zero baseline')
	const observed = (median(candidateBlocks) - baseline) / baseline
	const random = seededPrng(seed)
	const deltas = new Array<number>(resamples)
	for (let sample = 0; sample < resamples; sample++) {
		const base = new Array<number>(baselineBlocks.length)
		const candidate = new Array<number>(candidateBlocks.length)
		for (let i = 0; i < baselineBlocks.length; i++) {
			const index = Math.floor(random() * baselineBlocks.length)
			base[i] = baselineBlocks[index]!
			candidate[i] = candidateBlocks[index]!
		}
		const sampledBase = median(base)
		if (sampledBase === 0)
			throw new Error('bootstrap sampled a zero baseline')
		deltas[sample] = (median(candidate) - sampledBase) / sampledBase
	}
	return {
		medianDelta: observed,
		low: percentile(deltas, 2.5),
		high: percentile(deltas, 97.5),
		width: percentile(deltas, 97.5) - percentile(deltas, 2.5),
		resamples,
		seed
	}
}

export function bootstrapPairedMedianDifference(
	baselineBlocks: number[],
	candidateBlocks: number[],
	seed: number,
	resamples = 2_000
): BootstrapCI {
	if (baselineBlocks.length !== candidateBlocks.length)
		throw new Error('paired bootstrap requires equal block counts')
	if (baselineBlocks.length < 2)
		throw new Error('paired bootstrap requires at least two blocks')
	if (resamples < 2_000)
		throw new Error('paired bootstrap requires at least 2000 resamples')
	if (![...baselineBlocks, ...candidateBlocks].every(Number.isFinite))
		throw new Error('paired bootstrap requires finite samples')

	const differences = baselineBlocks.map(
		(baseline, index) => candidateBlocks[index]! - baseline
	)
	const random = seededPrng(seed)
	const deltas = new Array<number>(resamples)
	for (let sample = 0; sample < resamples; sample++) {
		const resampled = new Array<number>(differences.length)
		for (let i = 0; i < differences.length; i++)
			resampled[i] =
				differences[Math.floor(random() * differences.length)]!
		deltas[sample] = median(resampled)
	}
	const low = percentile(deltas, 2.5)
	const high = percentile(deltas, 97.5)
	return {
		medianDelta: median(differences),
		low,
		high,
		width: high - low,
		resamples,
		seed
	}
}

function normalizedRegression(
	delta: number,
	direction: Exclude<MetricDirection, 'equal'>
) {
	return direction === 'lower' ? delta : -delta
}

export function compareMetric(input: CompareInput): ComparisonResult {
	const margin = input.margin
	if (!Number.isFinite(margin) || margin < 0)
		throw new Error(`invalid margin for ${input.fixture}/${input.metric}`)
	if (input.kind === 'count') {
		const tolerance = input.tolerance ?? 0
		if (!Number.isInteger(tolerance) || tolerance < 0)
			throw new Error(
				`count metric tolerance must be a non-negative integer: ${input.fixture}/${input.metric}`
			)
		if (
			!input.baselineBlocks.every(Number.isInteger) ||
			!input.candidateBlocks.every(Number.isInteger)
		)
			throw new Error(
				`count metric samples are not integral: ${input.fixture}/${input.metric}`
			)
		const baseline = lowerMedian(input.baselineBlocks)
		const candidate = lowerMedian(input.candidateBlocks)
		const observedDelta = Math.abs(candidate - baseline)
		if (!Number.isInteger(observedDelta))
			throw new Error(
				`count metric delta is not integral: ${input.fixture}/${input.metric}`
			)
		const verdict: Verdict = observedDelta <= tolerance ? 'pass' : 'fail'
		return {
			fixture: input.fixture,
			metric: input.metric,
			kind: input.kind,
			direction: input.direction,
			claim: input.claim ?? 'non-regression',
			margin,
			tolerance,
			baseline,
			candidate,
			observedDelta,
			verdict
		}
	}
	if (input.direction === 'equal')
		throw new Error(
			`timing/memory metric cannot use equal direction: ${input.metric}`
		)
	const ci = bootstrapRelativeMedianDelta(
		input.baselineBlocks,
		input.candidateBlocks,
		input.seed,
		input.resamples
	)
	const low = normalizedRegression(ci.low, input.direction)
	const high = normalizedRegression(ci.high, input.direction)
	const regressionLow = Math.min(low, high)
	const regressionHigh = Math.max(low, high)
	const claim = input.claim ?? 'non-regression'
	const limit = claim === 'improvement' ? -margin : margin
	const verdict: Verdict =
		regressionHigh <= limit
			? 'pass'
			: regressionLow > limit
				? 'fail'
				: 'inconclusive'
	return {
		fixture: input.fixture,
		metric: input.metric,
		kind: input.kind,
		direction: input.direction,
		claim,
		margin,
		baseline: median(input.baselineBlocks),
		candidate: median(input.candidateBlocks),
		observedDelta: ci.medianDelta,
		ci: {
			low: regressionLow,
			high: regressionHigh,
			width: regressionHigh - regressionLow
		},
		verdict
	}
}

export function compareReportOnlyMetric(input: CompareInput): ComparisonResult {
	if (
		input.kind !== 'count' &&
		input.baselineBlocks.some((value) => value <= 0)
	) {
		const ci = bootstrapPairedMedianDifference(
			input.baselineBlocks,
			input.candidateBlocks,
			input.seed,
			input.resamples
		)
		const baseline = median(input.baselineBlocks)
		const candidate = median(input.candidateBlocks)
		return {
			fixture: input.fixture,
			metric: input.metric,
			kind: input.kind,
			direction: input.direction,
			claim: 'report-only',
			margin: 0,
			baseline,
			candidate,
			observedDelta: ci.medianDelta,
			deltaScale: 'raw-difference',
			ci: { low: ci.low, high: ci.high, width: ci.width },
			verdict: 'report-only'
		}
	}

	return {
		...compareMetric(input),
		claim: 'report-only',
		deltaScale: input.kind === 'count' ? 'raw-difference' : 'relative',
		verdict: 'report-only'
	}
}
