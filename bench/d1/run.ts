import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import {
	assertBenchSourceFileListCoversStaticImports,
	assertPreflightEqual,
	benchSourceHash,
	captureEnvironment,
	capturePinnedManifest,
	gitInfo
} from './env'
import type {
	ComparisonResult,
	FixtureSampleRecord,
	FloorsFile,
	FloorsSession,
	MarginEntry,
	PinnedManifest,
	RawArtifact,
	SampleBlockRecord,
	VariantDescriptor,
	VariantSide
} from './schema'
import {
	bootstrapRelativeMedianDelta,
	compareMetric,
	lowerMedian,
	percentile,
	summarize
} from './stats'

const repoRoot = resolve(import.meta.dir, '../..')
const traceRoot = resolve(repoRoot, 'trace/d1')
const baselineRoot = resolve(repoRoot, 'bench/d1/baseline')
const fixtureRoot = resolve(repoRoot, 'bench/d1/fixtures')
const defaultBlocks = 8
const defaultRoutes = 1_000
const defaultRequests = 200
const defaultWarmup = 50
const defaultRssWarmup = 20_000
const defaultRssStep = 10_000
const defaultRssBlocks = 4
const defaultResamples = 2_000
const fixtureIds = [
	'cold-start',
	'http',
	'default-headers',
	'compile-memory',
	'retained',
	'executables',
	'native-table'
] as const

type FixtureId = (typeof fixtureIds)[number]
type ChildOutput = Record<string, any>

interface RunContext {
	startedAt: string
	seed: number
	resamples: number
	commit: string
	dirty: boolean
	benchSourceHash: string
	environment: ReturnType<typeof captureEnvironment>
	command: string
}

interface BlockExecution {
	output: ChildOutput
	parentSamples?: Record<string, number[]>
	spawnToFirst2xxNs?: number
}

interface ReadyState {
	port: number
	fallback: boolean
}

interface MarginRegistry {
	entries: MarginEntry[]
	byKey: Map<string, MarginEntry>
}

interface ArtifactCapture {
	variants: VariantDescriptor[]
	fixtures: FixtureSampleRecord[]
	comparisons: ComparisonResult[]
	provenance: Record<string, unknown>
}

type PartialFixtureCapture = (records: FixtureSampleRecord[]) => void

const modes = ['record', 'aa', 'gate', 'self-test', 'verify'] as const
type D1Mode = (typeof modes)[number]

function key(fixture: string, metric: string) {
	return `${fixture}/${metric}`
}

function newArtifactCapture(): ArtifactCapture {
	return {
		variants: [],
		fixtures: [],
		comparisons: [],
		provenance: {}
	}
}

function captureFixtures(
	capture: ArtifactCapture,
	records: readonly FixtureSampleRecord[]
) {
	for (const record of records) {
		const index = capture.fixtures.findIndex(
			(item) =>
				item.fixture === record.fixture &&
				item.metric === record.metric &&
				item.variant === record.variant
		)
		if (index === -1) capture.fixtures.push(record)
		else capture.fixtures[index] = record
	}
}

function option(name: string) {
	return process.argv
		.find((argument) => argument.startsWith(`--${name}=`))
		?.slice(name.length + 3)
}

function effectiveSeed(seed: number) {
	return seed >>> 0 || 0x9e3779b9
}

function randomSeed() {
	const configured = option('seed') ?? process.env.D1_SEED
	const seed = configured === undefined ? Date.now() : Number(configured)
	if (!Number.isInteger(seed)) throw new Error(`invalid seed: ${configured}`)
	const effective = effectiveSeed(seed)
	if (seed >>> 0 === 0) throw new Error('seed must not normalize to zero')
	return effective
}

function parseJson(text: string, label: string) {
	const trimmed = text.trim()
	if (!trimmed) throw new Error(`${label} printed no JSON document`)
	try {
		return JSON.parse(trimmed) as ChildOutput
	} catch (error) {
		throw new Error(
			`${label} printed invalid JSON: ${String(error)}\n${trimmed.slice(0, 500)}`,
			{ cause: error }
		)
	}
}

function errorPayload(error: unknown): NonNullable<RawArtifact['error']> {
	if (error instanceof Error)
		return {
			name: error.name,
			message: error.message,
			...(error.stack ? { stack: error.stack } : {})
		}
	return { name: 'Error', message: String(error) }
}

function command(command_: string, args: string[]) {
	const result = Bun.spawnSync({
		cmd: [command_, ...args],
		stdout: 'pipe',
		stderr: 'pipe'
	})
	return {
		code: result.exitCode ?? 1,
		stdout: result.stdout
			? new TextDecoder().decode(result.stdout).trim()
			: '',
		stderr: result.stderr
			? new TextDecoder().decode(result.stderr).trim()
			: ''
	}
}

async function readReady(child: Bun.Subprocess) {
	if (!child.stderr || typeof child.stderr === 'number')
		throw new Error('fixture stderr is not piped')
	const reader = child.stderr.getReader()
	let stderr = ''
	let ready: ReadyState | undefined
	let resolveReady!: (state: ReadyState) => void
	let rejectReady!: (error: Error) => void
	const readyPromise = new Promise<ReadyState>((resolve_, reject_) => {
		resolveReady = resolve_
		rejectReady = reject_
	})
	const done = (async () => {
		try {
			while (true) {
				const chunk = await reader.read()
				if (chunk.done) break
				stderr += new TextDecoder().decode(chunk.value)
				const match = stderr.match(/D1_READY (\d+)( handle)?/)
				if (match && ready === undefined) {
					ready = {
						port: Number(match[1]),
						fallback: Boolean(match[2])
					}
					resolveReady(ready)
				}
			}
			if (ready === undefined)
				rejectReady(new Error(`fixture never became ready:\n${stderr}`))
		} catch (error) {
			rejectReady(
				error instanceof Error ? error : new Error(String(error))
			)
		}
		return stderr
	})()
	return { ready: readyPromise, done }
}

async function consume(response: Response) {
	if (!response.ok) throw new Error(`HTTP request failed: ${response.status}`)
	await response.arrayBuffer()
}

function httpRequest(base: string, shape: string, index: number) {
	switch (shape) {
		case 'plain-get':
			return fetch(`${base}/plain`)
		case 'dynamic-param':
			return fetch(`${base}/dynamic/${index % 100}`)
		case 'validated-json':
			return fetch(`${base}/json`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'elysia', age: index % 100 })
			})
		case 'coerced-query':
			return fetch(`${base}/query?page=${(index % 9) + 1}&limit=20`)
		case 'cookie':
			return fetch(`${base}/cookie`, {
				headers: { cookie: 'session=abc' }
			})
		case 'mixed':
			return fetch(`${base}/mixed/${index % 100}?page=2`, {
				headers: { cookie: 'session=abc' }
			})
		default:
			throw new Error(`unknown HTTP shape: ${shape}`)
	}
}

async function measureHttp(base: string) {
	const samples: Record<string, number[]> = {}
	const shapes = [
		'plain-get',
		'dynamic-param',
		'validated-json',
		'coerced-query',
		'cookie',
		'mixed'
	]
	for (const shape of shapes) {
		samples[shape] = []
		for (let i = 0; i < defaultWarmup; i++)
			await consume(await httpRequest(base, shape, i))
		for (let i = 0; i < defaultRequests; i++) {
			const started = Bun.nanoseconds()
			await consume(await httpRequest(base, shape, i))
			samples[shape]!.push(Bun.nanoseconds() - started)
		}
	}
	return samples
}

async function consumeDefaultHeader(response: Response) {
	if (!response.ok) throw new Error(`HTTP request failed: ${response.status}`)
	if (response.headers.get('x-d1-default') !== 'base')
		throw new Error('default-header response omitted x-d1-default')
	await response.arrayBuffer()
}

async function measureDefaultHeaders(base: string) {
	const samples: number[] = []
	for (let i = 0; i < defaultWarmup; i++)
		await consumeDefaultHeader(await fetch(`${base}/`))
	for (let i = 0; i < defaultRequests; i++) {
		const started = Bun.nanoseconds()
		await consumeDefaultHeader(await fetch(`${base}/`))
		samples.push(Bun.nanoseconds() - started)
	}
	// Prime the snapshot route before the retained-RSS observer window.
	await consumeDefaultHeader(await fetch(`${base}/__d1_snapshot`))
	for (let i = 0; i < defaultRssWarmup; i++)
		await consumeDefaultHeader(await fetch(`${base}/`))
	await consumeDefaultHeader(await fetch(`${base}/__d1_snapshot`))
	for (let block = 0; block < defaultRssBlocks; block++) {
		for (let i = 0; i < defaultRssStep; i++)
			await consumeDefaultHeader(await fetch(`${base}/`))
		await consumeDefaultHeader(await fetch(`${base}/__d1_snapshot`))
	}

	return { 'default-headers': samples }
}

async function runFixtureBlock(
	fixture: FixtureId,
	descriptor: VariantDescriptor,
	blockId: string
): Promise<BlockExecution> {
	const args = [
		'run',
		resolve(fixtureRoot, `${fixture}.ts`),
		'--json',
		`--routes=${defaultRoutes}`,
		`--warmup=${defaultWarmup}`,
		`--requests=${defaultRequests}`,
		`--rss-warmup=${defaultRssWarmup}`,
		`--rss-step=${defaultRssStep}`,
		`--rss-blocks=${defaultRssBlocks}`
	]
	const spawnStarted = process.hrtime.bigint()
	const child = Bun.spawn({
		cmd: args.map((value, index) =>
			index === 0 ? process.execPath : value
		),
		cwd: repoRoot,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			...descriptor.env,
			D1_ELYSIA_ROOT: descriptor.elysiaRoot,
			D1_PARENT: '1',
			D1_BLOCK: blockId
		},
		timeout: 120_000
	})
	const stdoutPromise = new Response(child.stdout).text()
	const stderrState =
		fixture === 'cold-start' ||
		fixture === 'http' ||
		fixture === 'default-headers'
			? await readReady(child)
			: {
					ready: Promise.resolve({ port: 0, fallback: false }),
					done: new Response(child.stderr).text()
				}
	let spawnToFirst2xxNs: number | undefined
	let parentSamples: Record<string, number[]> | undefined
	if (fixture === 'cold-start') {
		const ready = await stderrState.ready
		if (!ready.fallback) {
			const response = await fetch(`http://127.0.0.1:${ready.port}/`)
			await consume(response)
			spawnToFirst2xxNs = Number(process.hrtime.bigint() - spawnStarted)
		}
	} else if (fixture === 'http') {
		const ready = await stderrState.ready
		if (ready.fallback) {
			const fallbackOutput = await stdoutPromise
			parentSamples = parseJson(fallbackOutput, fixture).samples
		} else {
			parentSamples = await measureHttp(`http://127.0.0.1:${ready.port}`)
			await consume(
				await fetch(`http://127.0.0.1:${ready.port}/__d1_done`)
			)
		}
	} else if (fixture === 'default-headers') {
		const ready = await stderrState.ready
		if (ready.fallback) {
			const fallbackOutput = await stdoutPromise
			parentSamples = parseJson(fallbackOutput, fixture).samples
		} else {
			parentSamples = await measureDefaultHeaders(
				`http://127.0.0.1:${ready.port}`
			)
			await consumeDefaultHeader(
				await fetch(`http://127.0.0.1:${ready.port}/__d1_done`)
			)
		}
	}
	const [stdout, stderr, exitCode] = await Promise.all([
		stdoutPromise,
		stderrState.done,
		child.exited
	])
	if (exitCode !== 0)
		throw new Error(
			`${fixture} child exited ${exitCode}:\n${stderr}\n${stdout}`
		)
	const output = parseJson(stdout, fixture)
	if (
		fixture === 'cold-start' &&
		output.fallbackSpawnToFirst2xxNs !== undefined
	)
		spawnToFirst2xxNs = Number(output.fallbackSpawnToFirst2xxNs)
	return { output, parentSamples, spawnToFirst2xxNs }
}

function metricsFor(registry: MarginRegistry, fixture: FixtureId) {
	return registry.entries.filter((entry) => entry.fixture === fixture)
}

function rawMetricSamples(
	entry: MarginEntry,
	execution: BlockExecution
): { samples: number[]; value: number } {
	const output = execution.output
	if (entry.fixture === 'cold-start') {
		if (entry.metric === 'spawn-to-first-2xx-ns') {
			if (execution.spawnToFirst2xxNs === undefined)
				throw new Error('cold-start parent timing missing')
			return {
				samples: [execution.spawnToFirst2xxNs],
				value: execution.spawnToFirst2xxNs
			}
		}
		const value = Number(output.importToListenNs)
		return { samples: [value], value }
	}
	if (entry.fixture === 'http') {
		const suffix = entry.metric.match(/-(p50|p95|p99)-ns$/)?.[1]
		if (!suffix || !execution.parentSamples)
			throw new Error(`HTTP samples missing for ${entry.metric}`)
		const shapeName = entry.metric
			.replace(/-(p50|p95|p99)-ns$/, '')
			.replace('validated-json-post', 'validated-json')
			.replace('cookie-read-write', 'cookie')
		const samples = execution.parentSamples[shapeName]
		if (!samples?.length)
			throw new Error(`HTTP shape samples missing for ${shapeName}`)
		const percent = suffix === 'p50' ? 50 : suffix === 'p95' ? 95 : 99
		return { samples, value: percentile(samples, percent) }
	}
	if (entry.fixture === 'default-headers') {
		if (entry.metric === 'retained-rss-slope-bytes-per-request') {
			const value = Number(output.rssSlopeBytesPerRequest)
			return { samples: [value], value }
		}
		const suffix = entry.metric.match(/-(p50|p95|p99)-ns$/)?.[1]
		if (!suffix || !execution.parentSamples)
			throw new Error(
				`default-header samples missing for ${entry.metric}`
			)
		const samples = execution.parentSamples['default-headers']
		if (!samples?.length)
			throw new Error('default-header timing samples missing')
		const percent = suffix === 'p50' ? 50 : suffix === 'p95' ? 95 : 99
		return { samples, value: percentile(samples, percent) }
	}
	const values: Record<string, number> = {
		'build-highwater-bytes-per-route':
			Number(output.maxRSS) / Number(output.routes),
		'post-gc-current-bytes-per-route':
			Number(output.postGcCurrent) / Number(output.routes),
		'retained-current-bytes-per-route': Number(output.currentBytesPerRoute),
		'retained-heap-size-bytes-per-route': Number(
			output.heapSizeBytesPerRoute
		),
		'retained-extra-memory-bytes-per-route': Number(
			output.extraMemoryBytesPerRoute
		),
		'retained-rss-bytes-per-route': Number(output.rssBytesPerRoute),
		Structure: Number(output.counts?.Structure),
		FunctionExecutable: Number(output.counts?.FunctionExecutable),
		FunctionCodeBlock: Number(output.counts?.FunctionCodeBlock),
		UnlinkedFunctionExecutable: Number(
			output.counts?.UnlinkedFunctionExecutable
		),
		'promoted-routes': Number(output.promotedRoutes)
	}
	const value = values[entry.metric]
	if (!Number.isFinite(value))
		throw new Error(
			`fixture output missing ${entry.fixture}/${entry.metric}`
		)
	return { samples: [value], value }
}

function addBlock(
	record: FixtureSampleRecord,
	block: SampleBlockRecord,
	order: VariantSide
) {
	record.samples.push(...block.samples)
	record.blocks.push(block)
	record.blockIds.push(block.id)
	record.order.push(order)
}

function emptyRecord(
	entry: MarginEntry,
	variant: string,
	seed: number,
	resamples: number,
	routeSizeOrder: number[]
): FixtureSampleRecord {
	return {
		fixture: entry.fixture,
		variant,
		metric: entry.metric,
		kind: entry.kind,
		unit:
			entry.kind === 'count'
				? 'count'
				: entry.metric.endsWith('-ns')
					? 'ns'
					: entry.metric.endsWith('-bytes-per-request')
						? 'bytes-per-request'
						: 'bytes-per-route',
		sampleRule: entry.sampleRule,
		samples: [],
		blocks: [],
		blockIds: [],
		order: [],
		routeSizeOrder,
		seed,
		resamples
	}
}

async function runRecordBlocks(
	descriptor: VariantDescriptor,
	registry: MarginRegistry,
	seed: number,
	blocks = defaultBlocks,
	onPartial?: PartialFixtureCapture
) {
	const records = new Map<string, FixtureSampleRecord>()
	for (const fixture of fixtureIds)
		for (const entry of metricsFor(registry, fixture))
			records.set(
				key(fixture, entry.metric),
				emptyRecord(entry, descriptor.label, seed, defaultResamples, [
					defaultRoutes
				])
			)
	onPartial?.([...records.values()])
	for (const fixture of fixtureIds) {
		for (let index = 0; index < blocks; index++) {
			const execution = await runFixtureBlock(
				fixture,
				descriptor,
				`${fixture}-A-${index}`
			)
			for (const entry of metricsFor(registry, fixture)) {
				const raw = rawMetricSamples(entry, execution)
				addBlock(
					records.get(key(fixture, entry.metric))!,
					{
						id: `${fixture}-A-${index}`,
						variant: 'A',
						pairIndex: index,
						samples: raw.samples,
						value: raw.value
					},
					'A'
				)
			}
		}
	}
	return [...records.values()]
}

function shuffledPairOrder(seed: number, pair: number): 'AB' | 'BA' {
	let value = (seed + pair * 0x9e3779b9) >>> 0
	value ^= value << 13
	value ^= value >>> 17
	return (value & 1) === 0 ? 'AB' : 'BA'
}

async function runPairedBlocks(
	baseline: VariantDescriptor,
	candidate: VariantDescriptor,
	registry: MarginRegistry,
	seed: number,
	fixtures: readonly FixtureId[] = fixtureIds,
	blocks = defaultBlocks,
	onPartial?: PartialFixtureCapture
) {
	const records = new Map<string, FixtureSampleRecord>()
	for (const fixture of fixtures)
		for (const entry of metricsFor(registry, fixture)) {
			const record = emptyRecord(
				entry,
				candidate.label,
				seed,
				defaultResamples,
				[defaultRoutes]
			)
			record.pairs = []
			records.set(key(fixture, entry.metric), record)
		}
	onPartial?.([...records.values()])
	for (const fixture of fixtures) {
		for (let index = 0; index < blocks; index++) {
			const order = shuffledPairOrder(seed, index)
			const first = order === 'AB' ? baseline : candidate
			const second = order === 'AB' ? candidate : baseline
			const firstExecution = await runFixtureBlock(
				fixture,
				first,
				`${fixture}-${order}-${index}-1`
			)
			const secondExecution = await runFixtureBlock(
				fixture,
				second,
				`${fixture}-${order}-${index}-2`
			)
			for (const entry of metricsFor(registry, fixture)) {
				const firstRaw = rawMetricSamples(entry, firstExecution)
				const secondRaw = rawMetricSamples(entry, secondExecution)
				const aRaw = order === 'AB' ? firstRaw : secondRaw
				const bRaw = order === 'AB' ? secondRaw : firstRaw
				const a: SampleBlockRecord = {
					id: `${fixture}-${order}-${index}-A`,
					variant: 'A',
					pairIndex: index,
					samples: aRaw.samples,
					value: aRaw.value
				}
				const b: SampleBlockRecord = {
					id: `${fixture}-${order}-${index}-B`,
					variant: 'B',
					pairIndex: index,
					samples: bRaw.samples,
					value: bRaw.value
				}
				const record = records.get(key(fixture, entry.metric))!
				record.pairs!.push({
					id: `${fixture}-pair-${index}`,
					order,
					a,
					b
				})
				record.samples.push(...a.samples, ...b.samples)
				record.blocks.push(...(order === 'AB' ? [a, b] : [b, a]))
				record.blockIds.push(
					...(order === 'AB' ? [a.id, b.id] : [b.id, a.id])
				)
				record.order.push(
					...(order === 'AB'
						? (['A', 'B'] as VariantSide[])
						: (['B', 'A'] as VariantSide[]))
				)
			}
		}
	}
	return [...records.values()]
}

function blockValues(record: FixtureSampleRecord) {
	if (!record.pairs?.length) return record.blocks.map((block) => block.value)
	return {
		baseline: record.pairs.map((pair) => pair.a.value),
		candidate: record.pairs.map((pair) => pair.b.value)
	}
}

function validateMargins(value: unknown): MarginRegistry {
	if (!Array.isArray(value) || !value.length)
		throw new Error('margins.json must be a non-empty array')
	const entries = value as MarginEntry[]
	const byKey = new Map<string, MarginEntry>()
	for (const entry of entries) {
		if (
			!entry.fixture ||
			!entry.metric ||
			!entry.kind ||
			!entry.direction ||
			!entry.sampleRule ||
			!entry.owner
		)
			throw new Error(`invalid margin entry: ${JSON.stringify(entry)}`)
		if (
			entry.status !== 'pending-floor' &&
			entry.status !== 'active' &&
			entry.status !== 'report-only'
		)
			throw new Error(`invalid margin status: ${entry.status}`)
		if (entry.status !== 'active' && entry.margin !== null)
			throw new Error(
				`non-active margin must be null: ${entry.fixture}/${entry.metric}`
			)
		if (
			entry.status === 'active' &&
			(!Number.isFinite(entry.margin) ||
				entry.margin === null ||
				entry.margin < 0)
		)
			throw new Error(
				`active margin must be a non-negative number: ${entry.fixture}/${entry.metric}`
			)
		if (entry.kind === 'count' && entry.direction !== 'equal')
			throw new Error(
				`count metric must use equal direction: ${entry.fixture}/${entry.metric}`
			)
		if (
			entry.kind === 'count' &&
			(!Number.isInteger(entry.tolerance) || entry.tolerance! < 0)
		)
			throw new Error(
				`count metric must have a non-negative integer tolerance: ${entry.fixture}/${entry.metric}`
			)
		const entryKey = key(entry.fixture, entry.metric)
		if (byKey.has(entryKey))
			throw new Error(`duplicate margin entry: ${entryKey}`)
		byKey.set(entryKey, entry)
	}
	for (const fixture of fixtureIds)
		if (!entries.some((entry) => entry.fixture === fixture))
			throw new Error(`no metrics registered for ${fixture}`)
	return { entries, byKey }
}

async function loadMargins() {
	return validateMargins(
		JSON.parse(
			await readFile(resolve(repoRoot, 'bench/d1/margins.json'), 'utf8')
		)
	)
}

function summarizedRecord(record: FixtureSampleRecord): FixtureSampleRecord {
	if (!record.samples.length) return record
	const discrete = record.kind === 'count'
	if (!record.pairs?.length)
		return { ...record, summary: summarize(record.samples, discrete) }
	return {
		...record,
		summaries: {
			baseline: summarize(
				record.pairs.flatMap((pair) => pair.a.samples),
				discrete
			),
			candidate: summarize(
				record.pairs.flatMap((pair) => pair.b.samples),
				discrete
			)
		}
	}
}

function printSummary(record: FixtureSampleRecord) {
	const summarized = summarizedRecord(record)
	const format = (
		label: string,
		summary: NonNullable<typeof summarized.summary>
	) =>
		`${label ? `${label} ` : ''}median=${summary.median} p95=${summary.p95} p99=${summary.p99} MAD=${summary.mad}`
	if (summarized.summaries)
		console.log(
			`REPORT ${key(record.fixture, record.metric)} ${format('baseline', summarized.summaries.baseline)}; ${format('candidate', summarized.summaries.candidate)}`
		)
	else
		console.log(
			`REPORT ${key(record.fixture, record.metric)} ${format('', summarized.summary!)}`
		)
}

function contextArtifact(
	context: RunContext,
	mode: RawArtifact['mode'],
	variants: VariantDescriptor[],
	fixtures: FixtureSampleRecord[],
	comparisons?: ComparisonResult[],
	provenance?: Record<string, unknown>,
	error?: RawArtifact['error']
): RawArtifact {
	return {
		schemaVersion: 1,
		kind: 'd1',
		mode,
		commit: context.commit,
		dirty: context.dirty,
		machineId: context.environment.machineId,
		machine: context.environment.machine,
		bun: context.environment.bun,
		env: context.environment.env,
		benchSourceHash: context.benchSourceHash,
		command: context.command,
		startedAt: context.startedAt,
		seed: context.seed,
		resamples: context.resamples,
		variants,
		fixtures: fixtures.map(summarizedRecord),
		...(comparisons ? { comparisons } : {}),
		...(provenance ? { provenance } : {}),
		...(error ? { error } : {})
	}
}

async function writeTrace(artifact: RawArtifact, tag?: string) {
	await mkdir(traceRoot, { recursive: true })
	const stamp = artifact.startedAt
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z')
	const destination = resolve(
		traceRoot,
		`${artifact.mode}-${tag ? `${tag}-` : ''}${stamp}-${artifact.commit.slice(0, 8)}.json`
	)
	const temporary = `${destination}.tmp-${process.pid}`
	await Bun.write(temporary, JSON.stringify(artifact, null, 2) + '\n')
	await rename(temporary, destination)
	return destination
}

async function writeJson(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true })
	const temporary = `${path}.tmp-${process.pid}`
	await Bun.write(temporary, JSON.stringify(value, null, 2) + '\n')
	await rename(temporary, path)
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

function manifestPath(machineId: string) {
	return resolve(baselineRoot, machineId, 'manifest.json')
}

function baselinePath(machineId: string) {
	return resolve(baselineRoot, machineId, 'baseline.json')
}

function floorsPath(machineId: string) {
	return resolve(baselineRoot, machineId, 'floors.json')
}

async function exists(path: string) {
	try {
		await readFile(path)
		return true
	} catch {
		return false
	}
}

async function ensurePinned(machineId: string, create: boolean) {
	const path = manifestPath(machineId)
	if (!(await exists(path))) {
		if (!create) throw new Error(`missing pinned manifest: ${path}`)
		const manifest = await capturePinnedManifest(repoRoot)
		await writeJson(path, manifest)
		return manifest
	}
	const manifest = await readJson<PinnedManifest>(path)
	validateManifest(manifest)
	assertPreflightEqual(captureEnvironment(), manifest)
	return manifest
}

function descriptor(
	label: string,
	elysiaRoot: string,
	commit: string,
	env: Record<string, string> = {}
): VariantDescriptor {
	return { label, elysiaRoot, commit, env }
}

function comparisonForRecord(
	record: FixtureSampleRecord,
	entry: MarginEntry,
	margin: number,
	seed: number,
	resamples: number
) {
	const values = blockValues(record)
	if (typeof values !== 'object' || !('baseline' in values))
		throw new Error(`not a paired record: ${record.metric}`)
	return compareMetric({
		fixture: record.fixture,
		metric: record.metric,
		kind: entry.kind,
		direction: entry.direction,
		margin,
		tolerance: entry.tolerance,
		baselineBlocks: values.baseline,
		candidateBlocks: values.candidate,
		seed,
		resamples
	})
}

function verdictExitCode(results: readonly ComparisonResult[]) {
	if (results.some((result) => result.verdict === 'fail')) return 1
	if (results.some((result) => result.verdict === 'inconclusive')) return 2
	return 0
}

function floorWidth(
	record: FixtureSampleRecord,
	entry: MarginEntry,
	seed: number,
	resamples: number
) {
	const values = blockValues(record)
	if (typeof values !== 'object' || !('baseline' in values))
		throw new Error(`not a paired record: ${record.metric}`)
	if (entry.kind === 'count')
		return Math.abs(
			lowerMedian(values.candidate) - lowerMedian(values.baseline)
		)
	const ci = bootstrapRelativeMedianDelta(
		values.baseline,
		values.candidate,
		seed,
		resamples
	)
	return ci.width
}

function validateArtifact(value: unknown): asserts value is RawArtifact {
	if (!value || typeof value !== 'object')
		throw new Error('artifact is not an object')
	const artifact = value as Partial<RawArtifact>
	if (artifact.schemaVersion !== 1 || artifact.kind !== 'd1')
		throw new Error('artifact schemaVersion/kind mismatch')
	if (
		!artifact.commit ||
		!artifact.benchSourceHash ||
		!artifact.machineId ||
		!artifact.machine ||
		!artifact.bun ||
		!artifact.env
	)
		throw new Error('artifact is missing provenance')
	if (!Array.isArray(artifact.variants) || !artifact.variants.length)
		throw new Error('artifact has no variants')
	if (!Array.isArray(artifact.fixtures) || !artifact.fixtures.length)
		throw new Error('artifact has no fixture records')
	if (
		artifact.error !== undefined &&
		(!artifact.error.name || !artifact.error.message)
	)
		throw new Error('invalid artifact error payload')
	const variantLabels = new Set(
		artifact.variants.map((variant) => variant.label)
	)
	for (const variant of artifact.variants) {
		if (
			!variant.label ||
			!variant.elysiaRoot ||
			!variant.commit ||
			!variant.env
		)
			throw new Error('invalid variant descriptor')
	}
	for (const record of artifact.fixtures) {
		if (
			!record.fixture ||
			!record.variant ||
			!record.metric ||
			!record.kind ||
			!record.sampleRule
		)
			throw new Error('invalid fixture record')
		if (!variantLabels.has(record.variant))
			throw new Error(
				`fixture record variant is not declared: ${record.fixture}/${record.metric}/${record.variant}`
			)
		if (
			!Array.isArray(record.samples) ||
			!Array.isArray(record.blocks) ||
			!Array.isArray(record.blockIds) ||
			!Array.isArray(record.order)
		)
			throw new Error(
				`invalid sample arrays: ${record.fixture}/${record.metric}`
			)
		if (record.pairs && record.pairs.length !== record.blocks.length / 2)
			throw new Error(
				`paired block count mismatch: ${record.fixture}/${record.metric}`
			)
		for (const block of record.blocks)
			if (
				!block.id ||
				!['A', 'B'].includes(block.variant) ||
				!Array.isArray(block.samples) ||
				!Number.isFinite(block.value)
			)
				throw new Error(
					`invalid block: ${record.fixture}/${record.metric}`
				)
	}
}

function validateFloors(value: unknown): asserts value is FloorsFile {
	if (!value || typeof value !== 'object')
		throw new Error('floors file is not an object')
	const floors = value as Partial<FloorsFile>
	if (
		floors.schemaVersion !== 2 ||
		floors.kind !== 'd1-floors' ||
		!floors.machineId ||
		!floors.bun
	)
		throw new Error('floors schema mismatch')
	if (
		!Array.isArray(floors.sessions) ||
		!floors.floors ||
		!floors.countDeltas
	)
		throw new Error('floors file is incomplete')
	for (const session of floors.sessions) {
		if (
			!session.sessionId ||
			!session.startedAt ||
			!session.rawArtifact ||
			!session.widths ||
			!session.countDeltas ||
			!Number.isInteger(session.seed) ||
			session.seed === 0
		)
			throw new Error('invalid floor session')
		for (const width of Object.values(session.widths))
			if (!Number.isFinite(width) || width < 0)
				throw new Error('invalid floor width')
		for (const delta of Object.values(session.countDeltas))
			if (!Number.isInteger(delta) || delta < 0)
				throw new Error('invalid count delta')
	}
	for (const width of Object.values(floors.floors))
		if (!Number.isFinite(width) || width < 0)
			throw new Error('invalid final floor')
	for (const delta of Object.values(floors.countDeltas))
		if (!Number.isInteger(delta) || delta < 0)
			throw new Error('invalid final count delta')
}

function validateManifest(value: unknown): asserts value is PinnedManifest {
	if (!value || typeof value !== 'object')
		throw new Error('manifest is not an object')
	const manifest = value as Partial<PinnedManifest>
	if (
		manifest.schemaVersion !== 1 ||
		manifest.kind !== 'd1-manifest' ||
		!manifest.machineId ||
		!manifest.machine ||
		!manifest.bun?.version ||
		!manifest.bun.revision ||
		!manifest.env ||
		!manifest.benchSourceHash ||
		!manifest.createdAt
	)
		throw new Error('manifest schema mismatch')
}

async function makeContext(seed = randomSeed()) {
	seed = effectiveSeed(seed)
	const environment = captureEnvironment()
	const git = gitInfo(repoRoot)
	return {
		startedAt: new Date().toISOString(),
		seed,
		resamples: defaultResamples,
		commit: git.commit,
		dirty: git.dirty,
		benchSourceHash: await benchSourceHash(repoRoot),
		environment,
		command: process.argv.join(' ')
	}
}

function fallbackContext(): RunContext {
	let git = { commit: 'unavailable', dirty: true }
	try {
		git = gitInfo(repoRoot)
	} catch {}
	return {
		startedAt: new Date().toISOString(),
		seed: 0x9e3779b9,
		resamples: defaultResamples,
		commit: git.commit,
		dirty: git.dirty,
		benchSourceHash: 'unavailable',
		environment: captureEnvironment(),
		command: process.argv.join(' ')
	}
}

async function recordMode(
	registry: MarginRegistry,
	context: RunContext,
	capture: ArtifactCapture
) {
	const git = gitInfo(repoRoot)
	const variant = descriptor('candidate', repoRoot, git.commit)
	capture.variants.push(variant)
	if (process.argv.includes('--promote')) {
		if (git.dirty)
			throw new Error('refusing baseline promotion from a dirty git tree')
		await ensurePinned(context.environment.machineId, true)
	}
	const fixtures = await runRecordBlocks(
		variant,
		registry,
		context.seed,
		defaultBlocks,
		(records) => captureFixtures(capture, records)
	)
	captureFixtures(capture, fixtures)
	for (const record of fixtures)
		if (
			registry.byKey.get(key(record.fixture, record.metric))?.status ===
			'report-only'
		)
			printSummary(record)
	if (process.argv.includes('--promote')) {
		const artifact = contextArtifact(
			context,
			'record',
			capture.variants,
			capture.fixtures
		)
		await writeJson(baselinePath(context.environment.machineId), artifact)
		// Promotion re-establishes the pin: refresh the manifest so its
		// benchSourceHash matches the sources this baseline was recorded with.
		// Environment equality was already asserted when the context was made.
		await writeJson(
			manifestPath(context.environment.machineId),
			await capturePinnedManifest(repoRoot)
		)
		console.log(`promoted: ${baselinePath(context.environment.machineId)}`)
	}
}

async function aaMode(
	registry: MarginRegistry,
	context: RunContext,
	capture: ArtifactCapture
) {
	const manifest = await ensurePinned(context.environment.machineId, true)
	const git = gitInfo(repoRoot)
	const a = descriptor('A', repoRoot, git.commit)
	const b = descriptor('B', repoRoot, git.commit)
	capture.variants.push(a, b)
	const sessions: FloorsSession[] = []
	for (let sessionIndex = 0; sessionIndex < 3; sessionIndex++) {
		const seed = effectiveSeed(context.seed + sessionIndex)
		const sessionStartedAt = new Date().toISOString()
		const sessionCapture = newArtifactCapture()
		sessionCapture.variants.push(a, b)
		const fixtures = await runPairedBlocks(
			a,
			b,
			registry,
			seed,
			fixtureIds,
			defaultBlocks,
			(records) => {
				captureFixtures(capture, records)
				captureFixtures(sessionCapture, records)
			}
		)
		captureFixtures(capture, fixtures)
		captureFixtures(sessionCapture, fixtures)
		const widths: Record<string, number> = {}
		const countDeltas: Record<string, number> = {}
		for (const record of fixtures) {
			const entry = registry.byKey.get(
				key(record.fixture, record.metric)
			)!
			const destination = entry.kind === 'count' ? countDeltas : widths
			destination[key(record.fixture, record.metric)] = floorWidth(
				record,
				entry,
				seed,
				context.resamples
			)
		}
		const sessionId = `${context.startedAt}-${sessionIndex}`
		const rawArtifact = await writeTrace(
			contextArtifact(
				{ ...context, startedAt: sessionStartedAt, seed },
				'aa',
				sessionCapture.variants,
				sessionCapture.fixtures,
				undefined,
				{ sessionIndex, sessionId }
			),
			`session-${sessionIndex}`
		)
		const session: FloorsSession = {
			sessionId,
			startedAt: sessionStartedAt,
			seed,
			resamples: context.resamples,
			rawArtifact: relative(repoRoot, rawArtifact),
			widths,
			countDeltas,
			provenance: {
				machineId: context.environment.machineId,
				bun: manifest.bun,
				variants: [a, b]
			}
		}
		sessions.push(session)
		capture.provenance = {
			sessions: sessions.map(
				({ sessionId, rawArtifact, seed, startedAt }) => ({
					sessionId,
					rawArtifact,
					seed,
					startedAt
				})
			)
		}
	}
	const path = floorsPath(context.environment.machineId)
	let floors: FloorsFile = {
		schemaVersion: 2,
		kind: 'd1-floors',
		machineId: context.environment.machineId,
		bun: manifest.bun,
		sessions: [],
		floors: {},
		countDeltas: {}
	}
	if (await exists(path)) {
		const existing = await readJson<unknown>(path)
		if ((existing as Partial<FloorsFile>).schemaVersion === 2) {
			validateFloors(existing)
			floors = existing
		}
	}
	floors.sessions.push(...sessions)
	for (const session of sessions)
		for (const [metric, width] of Object.entries(session.widths))
			floors.floors[metric] = Math.max(floors.floors[metric] ?? 0, width)
	for (const session of sessions)
		for (const [metric, delta] of Object.entries(session.countDeltas))
			floors.countDeltas[metric] = Math.max(
				floors.countDeltas[metric] ?? 0,
				delta
			)
	await writeJson(path, floors)
	console.log(`floors: ${path}`)
}

async function gateMode(
	registry: MarginRegistry,
	context: RunContext,
	capture: ArtifactCapture
) {
	const active = registry.entries.filter((entry) => entry.status === 'active')
	if (!active.length)
		throw new Error(
			'no active D1 margins; run aa, then register numeric margins before gate'
		)
	const manifest = await ensurePinned(context.environment.machineId, false)
	const baseline = await readJson<RawArtifact>(
		baselinePath(context.environment.machineId)
	)
	validateArtifact(baseline)
	if (
		baseline.benchSourceHash !== context.benchSourceHash ||
		manifest.benchSourceHash !== context.benchSourceHash
	)
		throw new Error(
			'baseline benchSourceHash is stale; record and promote a new baseline'
		)
	const worktree = resolve(traceRoot, `baseline-worktree-${process.pid}`)
	await mkdir(traceRoot, { recursive: true })
	const added = command('git', [
		'worktree',
		'add',
		'--detach',
		worktree,
		baseline.commit
	])
	if (added.code !== 0)
		throw new Error(`cannot create baseline worktree: ${added.stderr}`)
	try {
		const git = gitInfo(repoRoot)
		const a = descriptor('baseline', worktree, baseline.commit)
		const b = descriptor('candidate', repoRoot, git.commit)
		capture.variants.push(a, b)
		const fixtures = await runPairedBlocks(
			a,
			b,
			registry,
			context.seed,
			fixtureIds,
			defaultBlocks,
			(records) => captureFixtures(capture, records)
		)
		captureFixtures(capture, fixtures)
		const results: ComparisonResult[] = []
		const floors = await readJson<FloorsFile>(
			floorsPath(context.environment.machineId)
		)
		validateFloors(floors)
		for (const entry of active) {
			const entryKey = key(entry.fixture, entry.metric)
			if (entry.kind === 'count') {
				const countDelta = floors.countDeltas[entryKey]
				if (countDelta === undefined)
					throw new Error(
						`missing A/A count delta for active margin ${entryKey}`
					)
				if (entry.tolerance! < countDelta)
					throw new Error(
						`count tolerance is below A/A delta for ${entryKey} (${entry.tolerance} < ${countDelta})`
					)
			} else {
				const floor = floors.floors[entryKey]
				if (floor === undefined)
					throw new Error(
						`missing A/A floor for active margin ${entryKey}`
					)
				if (entry.margin! <= floor)
					throw new Error(
						`margin must be greater than A/A floor for ${entryKey} (${entry.margin} <= ${floor})`
					)
			}
			const record = fixtures.find(
				(item) =>
					key(item.fixture, item.metric) ===
					key(entry.fixture, entry.metric)
			)
			if (!record)
				throw new Error(
					`gate did not collect ${key(entry.fixture, entry.metric)}`
				)
			const result = comparisonForRecord(
				record,
				entry,
				entry.margin!,
				context.seed,
				context.resamples
			)
			results.push(result)
			capture.comparisons.push(result)
		}
		for (const entry of registry.entries.filter(
			(item) => item.status === 'report-only'
		)) {
			const record = fixtures.find(
				(item) =>
					key(item.fixture, item.metric) ===
					key(entry.fixture, entry.metric)
			)
			if (!record)
				throw new Error(
					`gate did not collect ${key(entry.fixture, entry.metric)}`
				)
			printSummary(record)
			const result: ComparisonResult = {
				...comparisonForRecord(
					record,
					entry,
					0,
					context.seed,
					context.resamples
				),
				verdict: 'report-only'
			}
			capture.comparisons.push(result)
			console.log(
				`REPORT CI ${key(entry.fixture, entry.metric)} low=${result.ci!.low} high=${result.ci!.high} width=${result.ci!.width}`
			)
		}
		capture.provenance = {
			baselineManifest: manifest,
			activeMargins: active.map((entry) =>
				key(entry.fixture, entry.metric)
			)
		}
		for (const result of results)
			console.log(
				`${result.verdict.toUpperCase()} ${result.fixture}/${result.metric}`
			)
		process.exitCode = verdictExitCode(results)
	} finally {
		const removed = command('git', [
			'worktree',
			'remove',
			'--force',
			worktree
		])
		if (removed.code !== 0)
			console.error(
				`warning: could not remove baseline worktree: ${removed.stderr}`
			)
		await rm(worktree, { recursive: true, force: true })
	}
}

async function selfTest(
	registry: MarginRegistry,
	context: RunContext,
	capture: ArtifactCapture
) {
	const control = descriptor('control', repoRoot, context.commit, {
		D1_INJECT: ''
	})
	capture.variants.push(control)
	const classes: Array<{
		injection: string
		fixture: FixtureId
		targetMetrics: readonly string[]
	}> = [
		{
			injection: 'cold-start',
			fixture: 'cold-start',
			targetMetrics: ['spawn-to-first-2xx-ns']
		},
		{
			injection: 'http',
			fixture: 'http',
			targetMetrics: ['plain-get-p50-ns']
		},
		{
			injection: 'compile-highwater',
			fixture: 'compile-memory',
			targetMetrics: ['build-highwater-bytes-per-route']
		},
		{
			injection: 'retained',
			fixture: 'retained',
			targetMetrics: ['retained-current-bytes-per-route']
		},
		{
			injection: 'executables',
			fixture: 'executables',
			targetMetrics: ['FunctionExecutable']
		}
	]
	capture.provenance = {
		injections: classes.map((item) => item.injection),
		targetMetrics: Object.fromEntries(
			classes.map((item) => [item.injection, item.targetMetrics])
		),
		reportedMetrics: Object.fromEntries(
			classes.map((item) => [
				item.injection,
				metricsFor(registry, item.fixture).map((entry) => entry.metric)
			])
		),
		sampleRule:
			'8 paired blocks; self-test control and injected candidate use the same revision'
	}
	for (const item of classes) {
		if (!item.targetMetrics.length)
			throw new Error(
				`self-test injection has no target metrics: ${item.injection}`
			)
		const entries = item.targetMetrics.map((metric) => {
			const entry = registry.byKey.get(key(item.fixture, metric))
			if (!entry)
				throw new Error(
					`self-test target metric is not registered: ${key(item.fixture, metric)}`
				)
			return entry
		})
		const controlFixtures = await runPairedBlocks(
			control,
			control,
			registry,
			effectiveSeed(context.seed + capture.fixtures.length),
			[item.fixture],
			defaultBlocks,
			(records) => captureFixtures(capture, records)
		)
		captureFixtures(capture, controlFixtures)
		const controlResults = entries.map((entry) => {
			const controlRecord = controlFixtures.find(
				(record) => record.metric === entry.metric
			)
			if (!controlRecord)
				throw new Error(
					`self-test control did not collect ${key(item.fixture, entry.metric)}`
				)
			const values = blockValues(controlRecord)
			if (typeof values !== 'object' || !('baseline' in values))
				throw new Error('self-test control was not paired')
			const controlCI =
				entry.kind === 'count'
					? undefined
					: bootstrapRelativeMedianDelta(
							values.baseline,
							values.candidate,
							context.seed,
							context.resamples
						)
			const controlMargin =
				entry.kind === 'count'
					? 0
					: Math.max(
							Math.abs(controlCI!.low),
							Math.abs(controlCI!.high),
							0.01
						) + 0.01
			return comparisonForRecord(
				controlRecord,
				entry,
				controlMargin,
				context.seed,
				context.resamples
			)
		})
		capture.comparisons.push(
			...controlResults.map((result) => ({
				...result,
				metric: `${result.metric}:control`
			}))
		)
		if (controlResults.some((result) => result.verdict !== 'pass'))
			throw new Error(
				`self-test A/A control was not pass for ${item.injection}: ${controlResults.map((result) => `${result.metric}=${result.verdict}`).join(', ')}`
			)
		const injected = descriptor('injected', repoRoot, context.commit, {
			D1_INJECT: item.injection
		})
		capture.variants.push(injected)
		const injectedFixtures = await runPairedBlocks(
			control,
			injected,
			registry,
			effectiveSeed(context.seed + 100 + capture.fixtures.length),
			[item.fixture],
			defaultBlocks,
			(records) => captureFixtures(capture, records)
		)
		captureFixtures(capture, injectedFixtures)
		const injectedResults = entries.map((entry) => {
			const injectedRecord = injectedFixtures.find(
				(record) => record.metric === entry.metric
			)
			if (!injectedRecord)
				throw new Error(
					`self-test injected run did not collect ${key(item.fixture, entry.metric)}`
				)
			const controlResult = controlResults.find(
				(result) => result.metric === entry.metric
			)!
			return comparisonForRecord(
				injectedRecord,
				entry,
				controlResult.margin,
				context.seed,
				context.resamples
			)
		})
		capture.comparisons.push(...injectedResults)
		const classVerdict = injectedResults.every(
			(result) => result.verdict === 'fail'
		)
			? 'fail'
			: injectedResults.some(
						(result) => result.verdict === 'inconclusive'
				  )
				? 'inconclusive'
				: 'pass'
		if (classVerdict !== 'fail')
			throw new Error(
				`self-test ${item.injection} expected all target metrics to fail, got ${injectedResults.map((result) => `${result.metric}=${result.verdict}`).join(', ')}`
			)
		console.log(
			`PASS self-test ${item.injection}: targetMetrics=${item.targetMetrics.join(',')}; injected fail; A/A pass`
		)
	}
}

async function verifyMode(
	registry: MarginRegistry,
	context: RunContext,
	capture: ArtifactCapture
) {
	capture.variants.push(descriptor('verify', repoRoot, context.commit))
	await assertBenchSourceFileListCoversStaticImports(repoRoot)
	const environment = captureEnvironment()
	const currentHash = await benchSourceHash(repoRoot)
	const machineIds = (await readdir(baselineRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
	if (!(await exists(baselinePath(environment.machineId))))
		console.warn(
			`D1 verify: no baseline recorded for this machine (${environment.machineId}); OK with warning`
		)
	if (!machineIds.length)
		throw new Error('no committed D1 baseline directories')
	for (const machineId of machineIds) {
		const manifest = await readJson<PinnedManifest>(manifestPath(machineId))
		validateManifest(manifest)
		if (manifest.machineId !== machineId)
			throw new Error(
				`manifest machine ID does not match directory: ${machineId}`
			)
		if (manifest.benchSourceHash !== currentHash)
			throw new Error(
				`committed manifest benchSourceHash is stale: ${machineId}`
			)

		const floors = await readJson<FloorsFile>(floorsPath(machineId))
		validateFloors(floors)
		if (floors.machineId !== machineId)
			throw new Error(
				`floors machine ID does not match directory: ${machineId}`
			)
		if (JSON.stringify(floors.bun) !== JSON.stringify(manifest.bun))
			throw new Error(`manifest and floors Bun pins differ: ${machineId}`)
		for (const entry of registry.entries.filter(
			(item) => item.status === 'active'
		)) {
			const entryKey = key(entry.fixture, entry.metric)
			if (entry.kind === 'count') {
				const countDelta = floors.countDeltas[entryKey]
				if (countDelta === undefined)
					throw new Error(
						`active count margin has no A/A delta: ${entryKey}`
					)
				if (entry.tolerance! < countDelta)
					throw new Error(
						`count tolerance is below A/A delta: ${entryKey} (${entry.tolerance} < ${countDelta})`
					)
				continue
			}
			const floor = floors.floors[entryKey]
			if (floor === undefined)
				throw new Error(`active margin has no floor: ${entryKey}`)
			if (entry.margin! <= floor)
				throw new Error(`active margin is not above floor: ${entryKey}`)
		}

		const baselineFile = baselinePath(machineId)
		if (await exists(baselineFile)) {
			const baseline = await readJson<RawArtifact>(baselineFile)
			validateArtifact(baseline)
			if (baseline.machineId !== machineId)
				throw new Error(
					`baseline machine ID does not match directory: ${machineId}`
				)
			if (baseline.benchSourceHash !== currentHash)
				throw new Error(
					`committed baseline benchSourceHash is stale: ${machineId}`
				)
			if (
				JSON.stringify(manifest.machine) !==
					JSON.stringify(baseline.machine) ||
				JSON.stringify(manifest.bun) !== JSON.stringify(baseline.bun)
			)
				throw new Error(
					`manifest and baseline environment pins differ: ${machineId}`
				)
			const baselineKeys = new Set(
				baseline.fixtures.map((record) =>
					key(record.fixture, record.metric)
				)
			)
			for (const entry of registry.entries)
				if (!baselineKeys.has(key(entry.fixture, entry.metric)))
					throw new Error(
						`baseline ${machineId} is missing ${key(entry.fixture, entry.metric)}`
					)
		}
		console.log(`verify: baseline directory valid for ${machineId}`)
	}
	capture.provenance = { verifiedBaselineDirectories: machineIds }
}

function isMode(value: string | undefined): value is D1Mode {
	return value !== undefined && modes.includes(value as D1Mode)
}

async function runMode(mode: D1Mode) {
	const capture = newArtifactCapture()
	let context = fallbackContext()
	let failure: RawArtifact['error']
	try {
		context = await makeContext(mode === 'verify' ? 0 : undefined)
		const registry = await loadMargins()
		if (mode === 'record')
			return await recordMode(registry, context, capture)
		if (mode === 'aa') return await aaMode(registry, context, capture)
		if (mode === 'gate') return await gateMode(registry, context, capture)
		if (mode === 'self-test')
			return await selfTest(registry, context, capture)
		return await verifyMode(registry, context, capture)
	} catch (error) {
		failure = errorPayload(error)
		throw error
	} finally {
		const variants = capture.variants.length
			? capture.variants
			: [descriptor(mode, repoRoot, context.commit)]
		const artifact = contextArtifact(
			context,
			mode,
			variants,
			capture.fixtures,
			capture.comparisons,
			Object.keys(capture.provenance).length
				? capture.provenance
				: undefined,
			failure
		)
		const trace = await writeTrace(artifact)
		console.log(`${mode}: ${trace}`)
	}
}

async function main() {
	const mode = process.argv[2]
	if (!isMode(mode))
		throw new Error(
			'usage: run.ts record|aa|gate|self-test|verify [--promote]'
		)
	return runMode(mode)
}

try {
	await main()
} catch (error) {
	console.error(`D1 ${process.argv[2] ?? 'run'} error:`, error)
	process.exitCode = 3
}
