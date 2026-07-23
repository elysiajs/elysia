import { expect, it } from 'bun:test'

import { benchSourceHash } from '../../bench/d1/env'

const calibration = await Bun.file(
	new URL('../../bench/d1/post-n4-calibration.json', import.meta.url)
).json()
const margins = (await Bun.file(
	new URL('../../bench/d1/margins.json', import.meta.url)
).json()) as Array<{
	owner: string
	metric: string
	kind: 'memory' | 'count'
}>

it('pins a green Post-N+4 A/A and verify calibration', async () => {
	expect(calibration).toMatchObject({
		schemaVersion: 3,
		owner: 'Post-N+4',
		fixture: 'post-n4',
		baselineCommit: 'a5831b577e98fd4973c331ebfb075893c9679fd5',
		calibrationCommit: '0503e06e0c265c1099395efbe5e6fc23858a2b06',
		productSourceHash:
			'111b122572316ebb864a4bb639cb7d71198d32665a097db67e9464cf17d25552',
		benchSourceHash:
			'223947d784276e148cb1fed8476498ed96ef43f1873d49070871dfa9db713f32',
		pairedBlocksPerSession: 192,
		sessionCount: 3,
		dirty: false
	})
	expect(await benchSourceHash(new URL('../..', import.meta.url).pathname)).toBe(
		calibration.benchSourceHash
	)
	expect(calibration.rawArtifactPolicy).toContain('retained by CI')
	expect(calibration.sessions).toHaveLength(calibration.sessionCount)
	expect(calibration.sessions.map(({ seed }: { seed: number }) => seed)).toEqual([
		2316166207, 2316166208, 2316166209
	])
	for (const session of calibration.sessions) {
		expect(session.resamples).toBe(2000)
		expect(session.countDeltasAllZero).toBeTrue()
		expect(session.file).toMatch(/^trace\/d1\/aa-session-[0-2]-.+\.json$/)
		expect(session.sha256).toMatch(/^[a-f0-9]{64}$/)
	}
	for (const artifact of [
		calibration.artifacts.aggregate,
		calibration.artifacts.floors
	])
		expect(artifact).toMatchObject({
			commit: calibration.calibrationCommit,
			dirty: false,
			productSourceHash: calibration.productSourceHash,
			benchSourceHash: calibration.benchSourceHash
		})
	expect(calibration.artifacts.preRemovalVerify).toMatchObject({
		commit: calibration.calibrationCommit,
		dirty: false,
		benchSourceHash: calibration.benchSourceHash
	})
	expect(calibration.artifacts.priorRemovalVerifications).toHaveLength(2)
	expect(calibration.artifacts.finalRemovalVerify).toMatchObject({
		commit: 'e4a9511d9b200112156204e5f0e7364279c9d5e3',
		dirty: false,
		productSourceHash:
			'8115f787e21b0a17794ada6be42c0c577236f6d25fee118450c8f6b0e03b79e0',
		benchSourceHash: calibration.benchSourceHash
	})
	const entries = margins.filter((entry) => entry.owner === 'Post-N+4')
	const memory = entries
		.filter((entry) => entry.kind === 'memory')
		.map((entry) => entry.metric)
		.sort()
	const counts = entries
		.filter((entry) => entry.kind === 'count')
		.map((entry) => entry.metric)
		.sort()
	expect(Object.keys(calibration.floors).sort()).toEqual(memory)
	for (const session of calibration.sessions)
		expect(Object.keys(session.widths).sort()).toEqual(memory)
	expect(Object.keys(calibration.countDeltas).sort()).toEqual(counts)
	expect(Math.max(...Object.values<number>(calibration.floors))).toBeLessThan(
		0.02
	)
	expect(Object.values(calibration.countDeltas)).toEqual(
		Array(counts.length).fill(0)
	)
	for (const artifact of [
		calibration.artifacts.aggregate,
		calibration.artifacts.floors,
		calibration.artifacts.preRemovalVerify,
		...calibration.artifacts.priorRemovalVerifications,
		calibration.artifacts.finalRemovalVerify
	]) {
		expect(artifact.file).toMatch(/^(?:bench|trace)\/d1\/.+\.json$/)
		expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
	}
})
