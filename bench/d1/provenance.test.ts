import { expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	assertOwnerBenchSourcePins,
	floorsForBenchSourceHash,
	pinOwnerBenchSourceHashes,
	PRODUCT_SOURCE_INPUTS,
	productSourceHash
} from './env'
import type { FloorsFile, PinnedManifest } from './schema'

async function writeProduct(root: string, source = 'export const value = 1\n') {
	await mkdir(join(root, 'src'), { recursive: true })
	await Bun.write(join(root, 'src/index.ts'), source)
	for (const path of PRODUCT_SOURCE_INPUTS) {
		if (path === 'src') continue
		await Bun.write(join(root, path), `${path}\n`)
	}
}

it('hashes dirty product inputs independently of generated and ignored files', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ely-d1-source-hash-'))
	try {
		await writeProduct(root)
		const initial = await productSourceHash(root)
		expect(initial).toMatch(/^[a-f0-9]{64}$/)

		await mkdir(join(root, 'dist'), { recursive: true })
		await Bun.write(join(root, 'dist/index.mjs'), 'generated\n')
		await Bun.write(join(root, 'src/.DS_Store'), 'ignored\n')
		expect(await productSourceHash(root)).toBe(initial)

		await Bun.write(join(root, 'src/index.ts'), 'export const value = 2\n')
		expect(await productSourceHash(root)).not.toBe(initial)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

it('pins only calibrated owners without advancing the global harness pin', () => {
	const globalHash = '1'.repeat(64)
	const staleOwnerHash = '2'.repeat(64)
	const currentHash = '3'.repeat(64)
	const manifest = {
		benchSourceHash: globalHash,
		ownerBenchSourceHashes: { 'N+2c': staleOwnerHash }
	} as PinnedManifest

	const updated = pinOwnerBenchSourceHashes(
		manifest,
		new Set(['N+3b']),
		currentHash
	)

	expect(updated.benchSourceHash).toBe(globalHash)
	expect(updated.ownerBenchSourceHashes).toEqual({
		'N+2c': staleOwnerHash,
		'N+3b': currentHash
	})
	expect(manifest.ownerBenchSourceHashes).toEqual({
		'N+2c': staleOwnerHash
	})
	expect(() =>
		assertOwnerBenchSourcePins(updated, ['N+3b'], currentHash)
	).not.toThrow()
	expect(() =>
		assertOwnerBenchSourcePins(updated, ['N+2c'], currentHash)
	).toThrow("benchmark-source pin is stale for owner 'N+2c'")
})

it('rejects legacy manifests clearly until each selected owner runs A/A', () => {
	const manifest = { benchSourceHash: '1'.repeat(64) } as PinnedManifest
	const currentHash = '2'.repeat(64)

	expect(() =>
		assertOwnerBenchSourcePins(manifest, ['N+3b'], currentHash)
	).toThrow("has no benchmark-source pin for owner 'N+3b'")
})

it('discards every accumulated floor when the harness hash changes', () => {
	const staleHash = '1'.repeat(64)
	const currentHash = '2'.repeat(64)
	const stale = {
		benchSourceHash: staleHash,
		sessions: [{ sessionId: 'old' }],
		floors: { 'other-owner/metric': 0.1 },
		countDeltas: { 'other-owner/count': 1 }
	} as FloorsFile

	const reset = floorsForBenchSourceHash(stale, currentHash)
	expect(reset).toMatchObject({
		benchSourceHash: currentHash,
		sessions: [],
		floors: {},
		countDeltas: {}
	})
	expect(floorsForBenchSourceHash(reset, currentHash)).toBe(reset)
})
