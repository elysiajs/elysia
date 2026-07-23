import { describe, expect, it } from 'bun:test'

import { POST_N4_BASELINE_COMMIT } from '../../bench/d1/env'
import { comparators, formatMismatch } from './compare'
import { corpus } from './corpus'
import {
	CONTROL_SOURCE_FILES,
	assertControlSourceHashes,
	assertFrozenCurrentHarness,
	assertProofManifest,
	isChangedCase,
	parseWorkerOutput,
	responseFrom,
	runReplacementProof
} from './historical-oracle'
import proof from './post-n4-proof.json'

const result = runReplacementProof()
const expectedFor = (value: Awaited<typeof result>['oracle']) => ({
	variant: value.variant,
	root: value.root,
	productSourceHash: value.productSourceHash,
	worktreeStatusHash: value.worktreeStatusHash,
	originCommit: value.originCommit,
	originDirty: value.originDirty
})

describe('Post-N+4 replacement proof provenance', () => {
	it('pins one clean normal-product baseline for D1 and D2', async () => {
		await assertProofManifest()
		await assertFrozenCurrentHarness(corpus)
		expect(proof.baseline.commit).toBe(POST_N4_BASELINE_COMMIT)

		const value = await result
		expect(value.oracle.baseCommit).toBe(POST_N4_BASELINE_COMMIT)
		expect(value.candidate.baseCommit).toBe(POST_N4_BASELINE_COMMIT)
		expect(value.oracle.originCommit).toBe(POST_N4_BASELINE_COMMIT)
		expect(value.oracle.originDirty).toBeFalse()
		expect(value.candidate.originCommit).toBeTruthy()
		expect(typeof value.candidate.originDirty).toBe('boolean')
		expect([
			value.candidate.originCommit,
			value.candidate.originDirty
		]).not.toEqual([POST_N4_BASELINE_COMMIT, false])
		expect(value.oracle.variant).toBe('oracle')
		expect(value.candidate.variant).toBe('candidate')
		expect(value.oracle.productSourceHash).toBe(
			proof.baseline.productSourceHash
		)
		expect(value.oracle.compareSourceHash).toBe(
			proof.controlSourceHashes['test/differential/compare.ts']
		)
		expect(value.oracle.corpusSourceHash).toBe(
			proof.controlSourceHashes['test/differential/corpus.ts']
		)
		expect(value.oracle.pid).not.toBe(process.pid)
		expect(value.candidate.pid).not.toBe(process.pid)
		expect(value.candidate.pid).not.toBe(value.oracle.pid)
		expect(Object.keys(value.oracle.results)).toHaveLength(
			proof.baseline.d2Requests
		)
	})

	it('fails closed on crashes, malformed output, provenance skew, and missing cases', async () => {
		const invalidExpected = {
			variant: 'oracle' as const,
			root: '/tmp/unused',
			productSourceHash: proof.baseline.productSourceHash,
			worktreeStatusHash: '0'.repeat(64),
			originCommit: POST_N4_BASELINE_COMMIT,
			originDirty: false
		}
		expect(() =>
			parseWorkerOutput('', 'worker boom', 1, invalidExpected)
		).toThrow('child exited 1')
		expect(() =>
			parseWorkerOutput('{}\nextra', '', 0, invalidExpected)
		).toThrow('invalid or extra output')

		const value = (await result).oracle
		const provenanceSkew = structuredClone(value)
		provenanceSkew.baseCommit = '0'.repeat(40)
		expect(() =>
			parseWorkerOutput(
				JSON.stringify(provenanceSkew),
				'',
				0,
				expectedFor(value)
			)
		).toThrow('provenance mismatch')

		for (const field of [
			'variant',
			'root',
			'productSourceHash',
			'worktreeStatusHash',
			'originCommit',
			'compareSourceHash',
			'corpusSourceHash'
		] as const) {
			const tampered = structuredClone(value)
			;(tampered as any)[field] = 'tampered'
			expect(() =>
				parseWorkerOutput(
					JSON.stringify(tampered),
					'',
					0,
					expectedFor(value)
				)
			).toThrow('provenance mismatch')
		}
		const runtimeTamper = structuredClone(value)
		runtimeTamper.runtime.env.TZ = 'local'
		expect(() =>
			parseWorkerOutput(
				JSON.stringify(runtimeTamper),
				'',
				0,
				expectedFor(value)
			)
		).toThrow('provenance mismatch')
		const originTamper = structuredClone(value)
		originTamper.originDirty = !originTamper.originDirty
		expect(() =>
			parseWorkerOutput(
				JSON.stringify(originTamper),
				'',
				0,
				expectedFor(value)
			)
		).toThrow('provenance mismatch')

		const degenerate = structuredClone(value)
		degenerate.variant = 'candidate'
		degenerate.originCommit = POST_N4_BASELINE_COMMIT
		degenerate.originDirty = false
		expect(() =>
			parseWorkerOutput(JSON.stringify(degenerate), '', 0, {
				...expectedFor(degenerate),
				originCommit: POST_N4_BASELINE_COMMIT,
				originDirty: false
			})
		).toThrow('provenance mismatch')

		const missing = structuredClone(value)
		delete missing.results[Object.keys(missing.results)[0]!]
		expect(() =>
			parseWorkerOutput(
				JSON.stringify(missing),
				'',
				0,
				expectedFor(value)
			)
		).toThrow('result coverage mismatch')
	})

	it('detects byte changes in every controlling proof source', async () => {
		for (const file of CONTROL_SOURCE_FILES) {
			const source = await Bun.file(file).text()
			await expect(
				assertControlSourceHashes({ [file]: `${source}\n ` })
			).rejects.toThrow('control source changed')
		}
	})

	it('rejects missing, duplicate, or extra frozen corpus IDs', async () => {
		await expect(
			assertFrozenCurrentHarness(corpus.slice(1))
		).rejects.toThrow('frozen Post-N+4 matrix')
		await expect(
			assertFrozenCurrentHarness([...corpus, corpus[0]!])
		).rejects.toThrow('frozen Post-N+4 matrix')
	})
})

describe('Post-N+4 frozen behavior decisions', () => {
	it('matches every retained frozen corpus result', async () => {
		const { oracle, candidate } = await result
		for (const key of Object.keys(oracle.results)) {
			if (isChangedCase(key)) continue
			const separator = key.indexOf('/')
			const ctx = {
				corpusId: key.slice(0, separator),
				requestId: key.slice(separator + 1),
				lanePair: 'pre-replacement-vs-current@handle'
			}
			const old = responseFrom(oracle, key)
			const current = responseFrom(candidate, key)
			const mismatch =
				comparators.response(ctx, old.response, current.response) ??
				(old.observation === undefined
					? undefined
					: comparators.observation(
							ctx,
							old.observation,
							current.observation
						))
			if (mismatch) throw new Error(formatMismatch(mismatch))
		}
	})

	it('keeps async plugin provisional serving in both products', async () => {
		const { oracle, candidate } = await result
		expect(candidate.replacement).toEqual(oracle.replacement)
		expect(oracle.replacement).toMatchObject({
			before: {
				sync: { status: 200, body: 'sync' },
				outer: { status: 404 }
			},
			nestedPending: { status: 404 },
			after: {
				sync: { status: 200, body: 'sync' },
				outer: { status: 200, body: 'outer' },
				inner: { status: 200, body: 'inner' }
			},
			factory: { status: 200, body: 'factory' },
			failure: {
				reason: 'post-n4-plugin-failure',
				sync: { status: 200, body: 'sync' }
			}
		})
	})

	it('pins the exact pre-change custom-thenable outcomes', async () => {
		const { oracle } = await result
		const row = proof.matrix.find(
			(value) => value.id === 'custom-handler-thenables'
		) as any
		for (const [key, expected] of Object.entries(
			row.baselineCases
		) as Array<
			[string, { status: number; contentType: string; body: string }]
		>) {
			const actual = responseFrom(oracle, key).response
			expect(actual.status).toBe(expected.status)
			expect(actual.headers).toContainEqual([
				'content-type',
				expected.contentType
			])
			expect(new TextDecoder().decode(actual.body)).toBe(
				expected.body
			)
		}
	})

	it('detects an injected response skew', async () => {
		const { oracle, candidate } = await result
		const key = 'native-static-literal/literal'
		const old = responseFrom(oracle, key).response
		const changed = responseFrom(candidate, key).response
		changed.body = new TextEncoder().encode('injected-skew')
		expect(
			comparators.response(
				{
					corpusId: 'native-static-literal',
					requestId: 'literal',
					lanePair: 'pre-replacement-vs-current@handle'
				},
				old,
				changed
			)?.component
		).toBe('body')
	})
})
