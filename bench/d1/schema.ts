export const D1_SCHEMA_VERSION = 1 as const
export const D1_KIND = 'd1' as const

export type MetricKind = 'timing' | 'memory' | 'count'
export type MetricDirection = 'lower' | 'higher' | 'equal'
export type Verdict = 'pass' | 'fail' | 'inconclusive'
export type VariantSide = 'A' | 'B'

export interface VariantDescriptor {
	label: string
	elysiaRoot: string
	commit: string
	env: Record<string, string>
}

export interface MachineManifest {
	cpuModel: string
	arch: string
	platform: string
	osRelease: string
	osImage: {
		product: string
		build: string
	}
	power: {
		source: string
		lowPowerMode: string
	}
}

export interface BunManifest {
	version: string
	revision: string
}

export interface PinnedManifest {
	schemaVersion: 1
	kind: 'd1-manifest'
	machineId: string
	machine: MachineManifest
	bun: BunManifest
	env: Record<string, string>
	benchSourceHash: string
	createdAt: string
}

export interface SampleBlockRecord {
	id: string
	variant: VariantSide
	pairIndex?: number
	samples: number[]
	value: number
}

export interface MetricPairRecord {
	id: string
	order: 'AB' | 'BA'
	a: SampleBlockRecord
	b: SampleBlockRecord
}

export interface FixtureSampleRecord {
	fixture: string
	variant: string
	metric: string
	kind: MetricKind
	unit: string
	sampleRule: string
	samples: number[]
	blocks: SampleBlockRecord[]
	pairs?: MetricPairRecord[]
	blockIds: string[]
	order: VariantSide[]
	routeSizeOrder: number[]
	seed: number
	resamples: number
	summary?: {
		median: number
		p95: number
		p99: number
		mad: number
	}
	summaries?: {
		baseline: NonNullable<FixtureSampleRecord['summary']>
		candidate: NonNullable<FixtureSampleRecord['summary']>
	}
}

export interface ComparisonResult {
	fixture: string
	metric: string
	kind: MetricKind
	direction: MetricDirection
	margin: number
	tolerance?: number
	baseline: number
	candidate: number
	// With deltaScale=raw-difference this is the median paired block
	// difference, not candidate minus the two marginal medians above.
	observedDelta: number
	deltaScale?: 'relative' | 'raw-difference'
	ci?: {
		low: number
		high: number
		width: number
	}
	verdict: Verdict | 'report-only'
}

export function metricUnit(entry: Pick<MarginEntry, 'kind' | 'metric'>) {
	if (entry.kind === 'count') return 'count'
	if (entry.kind === 'timing') return 'ns'
	if (entry.metric.endsWith('-bytes-per-request')) return 'bytes-per-request'
	if (entry.metric.endsWith('-bytes-per-validator'))
		return 'bytes-per-validator'
	if (entry.metric.endsWith('-per-validator')) return 'count-per-validator'
	return 'bytes-per-route'
}

export function recordsAaFloor(entry: Pick<MarginEntry, 'status'>) {
	return entry.status !== 'report-only'
}

export interface RawArtifact {
	schemaVersion: 1
	kind: 'd1'
	mode: 'record' | 'aa' | 'gate' | 'self-test' | 'verify'
	commit: string
	dirty: boolean
	machineId: string
	machine: MachineManifest
	bun: BunManifest
	env: Record<string, string>
	benchSourceHash: string
	command: string
	startedAt: string
	seed: number
	resamples: number
	variants: VariantDescriptor[]
	fixtures: FixtureSampleRecord[]
	comparisons?: ComparisonResult[]
	provenance?: Record<string, unknown>
	error?: {
		name: string
		message: string
		stack?: string
	}
}

export interface MarginEntry {
	fixture: string
	metric: string
	kind: MetricKind
	direction: MetricDirection
	sampleRule: string
	owner: string
	// report-only: samples are collected and published in artifacts but never
	// gated — used for tail latency (p95/p99) whose A/A floors are too wide to gate.
	status: 'pending-floor' | 'active' | 'report-only'
	margin: number | null
	tolerance?: number
}

export interface FloorsSession {
	sessionId: string
	startedAt: string
	seed: number
	resamples: number
	rawArtifact: string
	widths: Record<string, number>
	countDeltas: Record<string, number>
	provenance: Record<string, unknown>
}

export interface FloorsFile {
	schemaVersion: 2
	kind: 'd1-floors'
	machineId: string
	bun: BunManifest
	sessions: FloorsSession[]
	floors: Record<string, number>
	countDeltas: Record<string, number>
}
