import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
	POST_N4_BASELINE_COMMIT,
	command,
	gitInfo,
	mirrorProductSource,
	productSourceHash
} from '../../bench/d1/env'
import proof from './post-n4-proof.json'
import {
	asyncPluginContract,
	customThenableContract
} from './replacement-corpus'
import type { ResponseSnapshot } from './compare'

const repoRoot = resolve(import.meta.dir, '../..')
const manifestFile = 'test/differential/post-n4-proof.json'
const calibrationFile = 'bench/d1/post-n4-calibration.json'
export const CONTROL_SOURCE_FILES = [
	'test/differential/historical-oracle.ts',
	'test/differential/replacement-oracle.test.ts',
	'test/differential/compare.ts',
	'test/differential/corpus.ts',
	'test/differential/replacement-corpus.ts',
	'bench/d1/env.ts',
	manifestFile
] as const
const baselineHarnessFiles = [
	'test/differential/compare.ts',
	'test/differential/corpus.ts'
] as const
const childEnvironment = {
	PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin',
	NODE_ENV: 'production',
	TZ: 'UTC',
	LANG: 'C',
	LC_ALL: 'C'
} as const
const expectedRuntime = {
	bunVersion: '1.3.14',
	bunRevision: '0d9b296af33f2b851fcbf4df3e9ec89751734ba4',
	platform: 'darwin',
	arch: 'arm64',
	osRelease: '27.0.0',
	env: childEnvironment
} as const
const expectedMatrix = [
	['frozen-handle-corpus', 'keep'],
	['async-plugin-provisional-serving', 'keep'],
	['custom-handler-thenables', 'change']
] as const
const expectedContracts = {
	'frozen-handle-corpus':
		'The 157 source-hashed handle requests and their recorded lifecycle observations remain byte-identical except the three exact custom-thenable cases named by the CHANGE row.',
	'async-plugin-provisional-serving':
		'Direct handle serves already-resolved routes while plugin routes are pending; nested plugin routes publish only after their drain completes; plugin failure leaves already-resolved routes available.',
	oldThenables:
		'Handler and beforeHandle custom thenables are mapped as plain objects; a throwing then getter enters the error path.',
	newThenables:
		'Structurally assimilate handler and beforeHandle thenables exactly once before response mapping; cover fulfillment across all four response sinks, rejection, throwing then getter, and cross-realm native promises.'
} as const
const expectedBaselineCases = {
	'async-thenable/handler-thenable': {
		status: 200,
		contentType: 'application/json;charset=utf-8',
		body: '{}'
	},
	'async-thenable/beforehandle-thenable': {
		status: 200,
		contentType: 'application/json;charset=utf-8',
		body: '{}'
	},
	'throwing-then-getter/handler-throwing-then': {
		status: 500,
		contentType: 'application/problem+json',
		body: '{"type":"internal-server-error","title":"Internal Server Error","status":500}'
	}
} as const
const expectedCandidateCases = [
	'handler-fulfillment/compact',
	'handler-fulfillment/set',
	'handler-fulfillment/default-headers',
	'handler-fulfillment/set-with-default-headers',
	'before-handle-fulfillment/compact',
	'before-handle-fulfillment/set',
	'before-handle-fulfillment/default-headers',
	'before-handle-fulfillment/set-with-default-headers',
	'handler-rejection',
	'before-handle-rejection',
	'handler-throwing-then-getter',
	'before-handle-throwing-then-getter',
	'handler-cross-realm-native-promise',
	'before-handle-cross-realm-native-promise'
] as const
const expectedBroaderThenableEvidence = [
	'test/compile/balanced-http-runtime.test.ts:1311',
	'test/aot/direct-app-plan.test.ts:196'
] as const
const expectedCandidateThenables: Awaited<
	ReturnType<typeof customThenableContract>
> = {
	handlerFulfillment: {
		compact: {
			status: 200,
			body: 'handler:compact',
			defaultHeader: null,
			sinkHeader: null
		},
		set: {
			status: 201,
			body: 'handler:set',
			defaultHeader: null,
			sinkHeader: 'set'
		},
		defaultHeaders: {
			status: 200,
			body: 'handler:default-headers',
			defaultHeader: 'default',
			sinkHeader: null
		},
		setWithDefaultHeaders: {
			status: 202,
			body: 'handler:set-with-default-headers',
			defaultHeader: 'default',
			sinkHeader: 'set-with-default-headers'
		}
	},
	beforeHandleFulfillment: {
		compact: {
			status: 200,
			body: 'before:compact',
			defaultHeader: null,
			sinkHeader: null
		},
		set: {
			status: 201,
			body: 'before:set',
			defaultHeader: null,
			sinkHeader: 'set'
		},
		defaultHeaders: {
			status: 200,
			body: 'before:default-headers',
			defaultHeader: 'default',
			sinkHeader: null
		},
		setWithDefaultHeaders: {
			status: 202,
			body: 'before:set-with-default-headers',
			defaultHeader: 'default',
			sinkHeader: 'set-with-default-headers'
		}
	},
	counts: {
		handler: {
			compact: { getter: 1, call: 1 },
			set: { getter: 1, call: 1 },
			defaultHeaders: { getter: 1, call: 1 },
			setWithDefaultHeaders: { getter: 1, call: 1 }
		},
		beforeHandle: {
			compact: { getter: 1, call: 1 },
			set: { getter: 1, call: 1 },
			defaultHeaders: { getter: 1, call: 1 },
			setWithDefaultHeaders: { getter: 1, call: 1 }
		},
		handlerRuns: {
			compact: 0,
			set: 0,
			defaultHeaders: 0,
			setWithDefaultHeaders: 0
		}
	},
	failures: {
		handlerRejection: {
			status: 500,
			body: 'caught:handler-rejection',
			defaultHeader: null,
			sinkHeader: null
		},
		beforeRejection: {
			status: 500,
			body: 'caught:before-rejection',
			defaultHeader: null,
			sinkHeader: null
		},
		handlerThrowingGetter: {
			status: 500,
			body: 'caught:handler-throwing-getter',
			defaultHeader: null,
			sinkHeader: null
		},
		beforeThrowingGetter: {
			status: 500,
			body: 'caught:before-throwing-getter',
			defaultHeader: null,
			sinkHeader: null
		},
		counts: {
			handlerRejection: { getter: 1, call: 1 },
			beforeRejection: { getter: 1, call: 1 },
			handlerThrowingGetter: { getter: 1, call: 0 },
			beforeThrowingGetter: { getter: 1, call: 0 }
		}
	},
	crossRealmNativePromise: {
		handler: {
			status: 200,
			body: 'cross-realm:handler',
			defaultHeader: null,
			sinkHeader: null
		},
		beforeHandle: {
			status: 200,
			body: 'cross-realm:before',
			defaultHeader: null,
			sinkHeader: null
		},
		beforeHandleHandlerRuns: 0
	}
}
const expectedLedger = [
	'lazy-precompile-false',
	'compat-cancellation',
	'aot-strip-and-fallback-modes',
	'legacy-compiler-fallback-machinery',
	'public-handler-index-compiler',
	'already-absent-aot-lazy-thresholds'
] as const
const expectedLedgerHash =
	'022697c98824b5c9d8d0b19195cd5b3951df5bb6313d91084f35e2fb68e06011'

interface SerializedSnapshot extends Omit<ResponseSnapshot, 'body'> {
	body: string
}

interface RuntimeProvenance {
	bunVersion: string
	bunRevision: string
	platform: string
	arch: string
	osRelease: string
	env: Record<string, string | undefined>
}

export interface ProductProofResult {
	pid: number
	variant: 'oracle' | 'candidate'
	root: string
	baseCommit: string
	originCommit: string
	originDirty: boolean
	worktreeStatusHash: string
	productSourceHash: string
	compareSourceHash: string
	corpusSourceHash: string
	caseIdHash: string
	entries: number
	requests: number
	runtime: RuntimeProvenance
	results: Record<
		string,
		{ response: SerializedSnapshot; observation?: unknown }
	>
	replacement: Awaited<ReturnType<typeof asyncPluginContract>>
	candidateThenables?: Awaited<ReturnType<typeof customThenableContract>>
}

export interface ReplacementProofResult {
	oracle: ProductProofResult
	candidate: ProductProofResult
}

const customThenableRow = proof.matrix.find(
	(row) => row.id === 'custom-handler-thenables'
) as (typeof proof.matrix)[number] & {
	candidateContractStatus: string
	candidateCases: readonly string[]
	broaderEvidence: readonly string[]
	baselineCases: Record<
		string,
		{ status: number; contentType: string; body: string }
	>
}
const changedCases = new Set(Object.keys(customThenableRow.baselineCases))

export const isChangedCase = (key: string) => changedCases.has(key)

const sha256 = (bytes: string | Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex')

async function fileHash(root: string, file: string) {
	return sha256(await readFile(resolve(root, file)))
}

const caseIds = (
	corpus: Array<{ id: string; requests: Array<{ id: string }> }>
) =>
	corpus.flatMap((entry) =>
		entry.requests.map((request) => `${entry.id}/${request.id}`)
	)

const idHash = (ids: readonly string[]) =>
	sha256([...ids].sort().join('\0'))

function normalizedManifest(value: string) {
	const expected = proof.controlSourceHashes[manifestFile]
	const marker = `"${manifestFile}": "${expected}"`
	if (value.split(marker).length !== 2)
		throw new Error('Post-N+4 manifest hash marker mismatch')
	return value.replace(
		marker,
		`"${manifestFile}": "${'0'.repeat(64)}"`
	)
}

export async function assertControlSourceHashes(
	overrides: Partial<Record<(typeof CONTROL_SOURCE_FILES)[number], string>> = {}
) {
	const hashes = proof.controlSourceHashes as Record<string, string>
	if (
		JSON.stringify(Object.keys(hashes).sort()) !==
		JSON.stringify([...CONTROL_SOURCE_FILES].sort())
	)
		throw new Error('Post-N+4 control-source set mismatch')
	for (const file of CONTROL_SOURCE_FILES) {
		const expected = hashes[file]
		if (!/^[a-f0-9]{64}$/.test(expected))
			throw new Error(`invalid Post-N+4 control hash: ${file}`)
		const source =
			overrides[file] ?? (await readFile(resolve(repoRoot, file), 'utf8'))
		const actual = sha256(
			file === manifestFile ? normalizedManifest(source) : source
		)
		if (actual !== expected)
			throw new Error(`Post-N+4 control source changed: ${file}`)
	}
}

const evidencePath = (value: string) => value.replace(/:\d+(?:-\d+)?$/, '')

async function assertEvidencePaths() {
	for (const row of [...proof.matrix, ...proof.removalLedger])
		for (const field of [
			'evidence',
			'tests',
			'documentation',
			'broaderEvidence'
		] as const)
			for (const value of (row as any)[field] ?? [])
				try {
					await stat(resolve(repoRoot, evidencePath(value)))
				} catch {
					throw new Error(
						`Post-N+4 missing ${field} path: ${value}`
					)
				}
}

export async function assertProofManifest() {
	if (proof.schemaVersion !== 2)
		throw new Error('Post-N+4 proof schema version mismatch')
	if (
		proof.baseline.commit !== POST_N4_BASELINE_COMMIT ||
		proof.baseline.d1.baselineCommit !== POST_N4_BASELINE_COMMIT
	)
		throw new Error('Post-N+4 D1 and D2 baseline commits differ')
	for (const [name, value] of Object.entries({
		productSourceHash: proof.baseline.productSourceHash,
		d2CaseIdHash: proof.baseline.d2CaseIdHash,
		d1ProductSourceHash: proof.baseline.d1.productSourceHash,
		benchSourceHash: proof.baseline.d1.benchSourceHash
	}))
		if (!/^[a-f0-9]{64}$/.test(value))
			throw new Error(`invalid Post-N+4 ${name}`)
	if (proof.baseline.d1.productSourceHash !== proof.baseline.productSourceHash)
		throw new Error('Post-N+4 D1 product baseline mismatch')
	if (
		proof.baseline.d1.calibrationStatus !== 'calibrated' ||
		proof.baseline.d1.calibrationArtifact !== calibrationFile ||
		!/^[a-f0-9]{64}$/.test(proof.baseline.d1.calibrationArtifactHash) ||
		(await fileHash(repoRoot, calibrationFile)) !==
			proof.baseline.d1.calibrationArtifactHash
	)
		throw new Error('Post-N+4 D1 recalibration status mismatch')
	if (
		JSON.stringify(proof.baseline.d2Runtime) !==
		JSON.stringify(expectedRuntime)
	)
		throw new Error('Post-N+4 runtime pin mismatch')
	if (
		JSON.stringify(proof.matrix.map(({ id, decision }) => [id, decision])) !==
		JSON.stringify(expectedMatrix)
	)
		throw new Error('Post-N+4 matrix rows mismatch')
	const frozen = proof.matrix[0]!
	const plugins = proof.matrix[1]!
	if (
		!('contract' in frozen) ||
		frozen.contract !== expectedContracts['frozen-handle-corpus'] ||
		!('contract' in plugins) ||
		plugins.contract !==
			expectedContracts['async-plugin-provisional-serving'] ||
		customThenableRow.oldContract !== expectedContracts.oldThenables ||
		customThenableRow.newContract !== expectedContracts.newThenables ||
		customThenableRow.candidateContractStatus !==
			'verified-runtime-assertions' ||
		JSON.stringify(customThenableRow.candidateCases) !==
			JSON.stringify(expectedCandidateCases) ||
		JSON.stringify(customThenableRow.broaderEvidence) !==
			JSON.stringify(expectedBroaderThenableEvidence) ||
		JSON.stringify(customThenableRow.baselineCases) !==
			JSON.stringify(expectedBaselineCases)
	)
		throw new Error('Post-N+4 matrix contract mismatch')
	if (
		JSON.stringify(proof.removalLedger.map(({ id }) => id)) !==
		JSON.stringify(expectedLedger) ||
		sha256(JSON.stringify(proof.removalLedger)) !== expectedLedgerHash ||
		proof.removalLedger.some(
			(row) =>
				row.decision !== 'delete' ||
				![row.api, row.replacement, row.reason].every(
					(value) => typeof value === 'string' && value.length > 0
				) ||
				!row.tests.length ||
				!row.documentation.length
		)
	)
		throw new Error('Post-N+4 removal ledger mismatch')
	if (
		JSON.stringify([...changedCases]) !==
		JSON.stringify([
			'async-thenable/handler-thenable',
			'async-thenable/beforehandle-thenable',
			'throwing-then-getter/handler-throwing-then'
		])
	)
		throw new Error('Post-N+4 changed-case set mismatch')
	if (
		JSON.stringify(proof.d1Gates) !==
		JSON.stringify({
			baselineOwner: 'Post-N+4',
			fixture: 'post-n4',
			pairedBlocks: 192,
			memoryMargin: 0.02,
			executableIncrease: 0,
			handlerNewFunctionMaximum: 0,
			unregisteredExitGates: [
				'request performance',
				'real socket',
				'default gzip',
				'cold start'
			]
		})
	)
		throw new Error('Post-N+4 D1 gate declaration mismatch')
	for (const row of proof.matrix)
		if (
			!('contract' in row ? row.contract : row.newContract) ||
			!row.evidence?.length
		)
			throw new Error(`Post-N+4 incomplete matrix row: ${row.id}`)
	await assertEvidencePaths()
	await assertControlSourceHashes()
}

export async function assertFrozenCurrentHarness(corpus: Array<any>) {
	await assertProofManifest()
	const ids = caseIds(corpus)
	if (
		corpus.length !== proof.baseline.d2Entries ||
		ids.length !== proof.baseline.d2Requests ||
		new Set(ids).size !== ids.length ||
		idHash(ids) !== proof.baseline.d2CaseIdHash
	)
		throw new Error(
			'current D2 corpus differs from the frozen Post-N+4 matrix'
		)
	for (const key of changedCases)
		if (!ids.includes(key))
			throw new Error(`Post-N+4 changed case is absent: ${key}`)
}

function git(root: string, args: string[]) {
	const result = command('git', ['-C', root, ...args])
	if (result.code !== 0)
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
	return result.stdout
}

async function assertBaselineHarness(root: string) {
	if (git(root, ['rev-parse', 'HEAD']) !== proof.baseline.commit)
		throw new Error('Post-N+4 worktree commit mismatch')
	for (const file of baselineHarnessFiles)
		if (
			(await fileHash(root, file)) !==
			proof.controlSourceHashes[file]
		)
			throw new Error(`Post-N+4 baseline source mismatch: ${file}`)
}

const runtimeProvenance = (): RuntimeProvenance => ({
	bunVersion: Bun.version,
	bunRevision: Bun.revision,
	platform: process.platform,
	arch: process.arch,
	osRelease: release(),
	env: Object.fromEntries(
		Object.keys(childEnvironment).map((key) => [key, process.env[key]])
	)
})

const decodeSnapshot = (snapshot: SerializedSnapshot): ResponseSnapshot => ({
	...snapshot,
	body: new Uint8Array(Buffer.from(snapshot.body, 'base64'))
})

export const responseFrom = (
	result: ProductProofResult,
	key: string
): { response: ResponseSnapshot; observation?: unknown } => {
	const value = result.results[key]
	if (!value) throw new Error(`Post-N+4 child omitted ${key}`)
	return { ...value, response: decodeSnapshot(value.response) }
}

export function parseWorkerOutput(
	stdout: string,
	stderr: string,
	exitCode: number,
	expected: {
		variant: 'oracle' | 'candidate'
		root: string
		productSourceHash: string
		worktreeStatusHash: string
		originCommit: string
		originDirty: boolean
	}
): ProductProofResult {
	if (exitCode !== 0)
		throw new Error(
			`Post-N+4 child exited ${exitCode}: ${stderr.trim() || '<no stderr>'}`
		)
	let value: ProductProofResult
	try {
		value = JSON.parse(stdout.trim())
	} catch {
		throw new Error('Post-N+4 child emitted invalid or extra output')
	}
	if (
		value.variant !== expected.variant ||
		value.root !== expected.root ||
		value.baseCommit !== proof.baseline.commit ||
		(value.variant === 'candidate' &&
			value.originCommit === proof.baseline.commit &&
			!value.originDirty) ||
		value.originCommit !== expected.originCommit ||
		value.originDirty !== expected.originDirty ||
		value.worktreeStatusHash !== expected.worktreeStatusHash ||
		value.productSourceHash !== expected.productSourceHash ||
		value.compareSourceHash !== proof.controlSourceHashes['test/differential/compare.ts'] ||
		value.corpusSourceHash !== proof.controlSourceHashes['test/differential/corpus.ts'] ||
		value.caseIdHash !== proof.baseline.d2CaseIdHash ||
		value.entries !== proof.baseline.d2Entries ||
		value.requests !== proof.baseline.d2Requests ||
		JSON.stringify(value.runtime) !== JSON.stringify(expectedRuntime) ||
		!Number.isInteger(value.pid) ||
		value.pid === process.pid
	)
		throw new Error('Post-N+4 child provenance mismatch')
	if (
		value.variant === 'candidate'
			? JSON.stringify(value.candidateThenables) !==
				JSON.stringify(expectedCandidateThenables)
			: value.candidateThenables !== undefined
	)
		throw new Error('Post-N+4 candidate thenable contract mismatch')
	const keys = Object.keys(value.results)
	if (
		keys.length !== proof.baseline.d2Requests ||
		new Set(keys).size !== keys.length ||
		idHash(keys) !== proof.baseline.d2CaseIdHash
	)
		throw new Error('Post-N+4 child result coverage mismatch')
	return value
}

async function runChild(
	variant: 'oracle' | 'candidate',
	root: string,
	expectedProductSourceHash: string,
	origin: { commit: string; dirty: boolean }
) {
	const worktreeStatusHash = sha256(git(root, ['status', '--porcelain']))
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			'run',
			import.meta.path,
			'--post-n4-worker',
			`--variant=${variant}`,
			`--origin-commit=${origin.commit}`,
			`--origin-dirty=${origin.dirty}`,
			`--root=${root}`
		],
		cwd: repoRoot,
		env: childEnvironment,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 120_000
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	])
	return parseWorkerOutput(stdout, stderr, exitCode, {
		variant,
		root,
		productSourceHash: expectedProductSourceHash,
		worktreeStatusHash,
		originCommit: origin.commit,
		originDirty: origin.dirty
	})
}

export async function runReplacementProof(): Promise<ReplacementProofResult> {
	await assertProofManifest()
	const currentHash = await productSourceHash(repoRoot)
	const currentOrigin = gitInfo(repoRoot)
	const parent = await mkdtemp(join(tmpdir(), 'elysia-post-n4-d2-'))
	const oracleRoot = join(parent, 'oracle')
	const candidateRoot = join(parent, 'candidate')
	const added: string[] = []
	try {
		for (const root of [oracleRoot, candidateRoot]) {
			const result = command('git', [
				'worktree',
				'add',
				'--detach',
				root,
				proof.baseline.commit
			])
			if (result.code !== 0)
				throw new Error(
					`cannot create Post-N+4 worktree: ${result.stderr}`
				)
			added.push(root)
			await assertBaselineHarness(root)
		}
		if (git(oracleRoot, ['status', '--porcelain']))
			throw new Error('Post-N+4 oracle worktree is not clean')
		if (
			(await productSourceHash(oracleRoot)) !==
			proof.baseline.productSourceHash
		)
			throw new Error('Post-N+4 oracle product source hash mismatch')

		await mirrorProductSource(repoRoot, candidateRoot)
		if ((await productSourceHash(candidateRoot)) !== currentHash)
			throw new Error('Post-N+4 candidate product mirror mismatch')
		const [oracle, candidate] = await Promise.all([
			runChild(
				'oracle',
				oracleRoot,
				proof.baseline.productSourceHash,
				{ commit: proof.baseline.commit, dirty: false }
			),
			runChild('candidate', candidateRoot, currentHash, currentOrigin)
		])
		if (oracle.pid === candidate.pid)
			throw new Error('Post-N+4 variants reused a child process')
		if (
			(await productSourceHash(repoRoot)) !== currentHash ||
			(await productSourceHash(oracleRoot)) !==
				proof.baseline.productSourceHash ||
			(await productSourceHash(candidateRoot)) !== currentHash
		)
			throw new Error('Post-N+4 product source changed during D2')
		if (git(oracleRoot, ['status', '--porcelain']))
			throw new Error('Post-N+4 oracle was modified during D2')
		await assertControlSourceHashes()
		return { oracle, candidate }
	} finally {
		for (const root of added.reverse()) {
			const removed = command('git', [
				'worktree',
				'remove',
				'--force',
				root
			])
			if (removed.code !== 0)
				console.error(
					`warning: could not remove Post-N+4 worktree: ${removed.stderr}`
				)
		}
		await rm(parent, { recursive: true, force: true })
	}
}

async function worker(
	root: string,
	variant: 'oracle' | 'candidate',
	originCommit: string,
	originDirty: boolean
) {
	const [{ corpus }, { snapshot }, { Elysia }] = await Promise.all([
		import(pathToFileURL(resolve(root, 'test/differential/corpus.ts')).href),
		import(pathToFileURL(resolve(root, 'test/differential/compare.ts')).href),
		import(pathToFileURL(resolve(root, 'src/index.ts')).href)
	])
	const ids = caseIds(corpus)
	const results: ProductProofResult['results'] = {}
	for (const entry of corpus)
		for (const request of entry.requests) {
			const key = `${entry.id}/${request.id}`
			const observe = entry.recorder
				? () => [...entry.recorder.events]
				: undefined
			const app = entry.define(new Elysia())
			await (app as any).modules
			;(app as any).compile()
			entry.recorder?.reset()
			const response = await snapshot(await app.handle(request.make()))
			if (Array.isArray(request.expectedObservation))
				for (
					let attempt = 0;
					attempt < 20 &&
					entry.recorder.events.length <
						request.expectedObservation.length;
					attempt++
				)
					await Bun.sleep(1)
			results[key] = {
				response: {
					...response,
					body: Buffer.from(response.body).toString('base64')
				},
				...(observe ? { observation: observe() } : {})
			}
		}

	const output: ProductProofResult = {
		pid: process.pid,
		variant,
		root,
		baseCommit: git(root, ['rev-parse', 'HEAD']),
		originCommit,
		originDirty,
		worktreeStatusHash: sha256(git(root, ['status', '--porcelain'])),
		productSourceHash: await productSourceHash(root),
		compareSourceHash: await fileHash(
			root,
			'test/differential/compare.ts'
		),
		corpusSourceHash: await fileHash(root, 'test/differential/corpus.ts'),
		caseIdHash: idHash(ids),
		entries: corpus.length,
		requests: ids.length,
		runtime: runtimeProvenance(),
		results,
		replacement: await asyncPluginContract(root),
		...(variant === 'candidate'
			? { candidateThenables: await customThenableContract(root) }
			: {})
	}
	console.log(JSON.stringify(output))
}

if (process.argv.includes('--post-n4-worker')) {
	const root = process.argv
		.find((argument) => argument.startsWith('--root='))
		?.slice('--root='.length)
	const variant = process.argv
		.find((argument) => argument.startsWith('--variant='))
		?.slice('--variant='.length)
	const originCommit = process.argv
		.find((argument) => argument.startsWith('--origin-commit='))
		?.slice('--origin-commit='.length)
	const originDirty = process.argv
		.find((argument) => argument.startsWith('--origin-dirty='))
		?.slice('--origin-dirty='.length)
	if (
		!root ||
		(variant !== 'oracle' && variant !== 'candidate') ||
		!originCommit ||
		(originDirty !== 'true' && originDirty !== 'false')
	)
		throw new Error('Post-N+4 worker provenance is incomplete')
	await worker(root, variant, originCommit, originDirty === 'true')
}
