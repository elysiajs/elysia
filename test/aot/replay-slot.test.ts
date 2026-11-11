import { describe, it, expect, afterEach, spyOn } from 'bun:test'
import { resolve } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'

import { Compiled, frozenRouteValidator } from '../../src/compile/aot'
import { installReconstructImpl } from '../../src/compile/aot-emit'
import { generateCompiledArtifacts } from '../../src/plugin/aot/core'
import { claimManifest } from './_manifest'

/**
 * The replay helpers ship only through `Compiled.replay`, set by the generated
 * manifest. A program that froze a validator but was claimed without them must
 * fail loud: a frozen route must never fall back to a live validator, or none.
 * One that froze nothing has no builder to import, and must still serve
 */
describe('AOT replay slot', () => {
	const hook = {
		query: {
			'~kind': 'Object',
			type: 'object',
			properties: { q: { '~kind': 'String', type: 'string' } }
		}
	} as any
	const rootOf = (manifest: Parameters<typeof claimManifest>[0]) =>
		({ ...claimManifest(manifest), '~config': {}, '~ext': {} }) as any

	afterEach(() => {
		installReconstructImpl()
		Compiled.clear()
	})

	it('throws when a program with frozen validators has no replay installed', () => {
		Compiled.replay = undefined

		// no manifest: nothing was frozen, the caller compiles live
		const plain = { '~config': {}, '~ext': {} } as any
		expect(frozenRouteValidator(hook, plain, 'GET', '/q')).toBeUndefined()

		const root = rootOf({
			validators: { GET: { '/q': { query: {} } } } as any
		})
		expect(() => frozenRouteValidator(hook, root, 'GET', '/q')).toThrow(
			'[elysia-aot] Replay module is not installed'
		)
	})

	it('compiles live when a program froze nothing', () => {
		Compiled.replay = undefined

		// what the emitter writes with no captured validator: no builder import
		for (const manifest of [
			{ lazyGroups: [], lazyGroupOf: {}, handlers: {} },
			{ validators: {}, handlers: {} }
		]) {
			const root = rootOf(manifest as any)
			expect(
				frozenRouteValidator(hook, root, 'GET', '/q')
			).toBeUndefined()
			Compiled.clear()
		}
	})

	// builds the manifest in this process, then serves it from a fresh one:
	// this process's capture module pre-installs the replay
	const runChild = async (
		fixture: string,
		options: Parameters<typeof generateCompiledArtifacts>[1],
		check: (source: string) => void
	) => {
		const app = resolve(import.meta.dir, fixture)
		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = 'keep'
		const log = spyOn(console, 'log').mockImplementation(() => {})

		let source: string
		try {
			source = (await generateCompiledArtifacts(app, options)).source
		} finally {
			log.mockRestore()
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}
		check(source)

		const directory = await mkdtemp(resolve(import.meta.dir, '_replay-'))
		try {
			const manifest = resolve(directory, 'manifest.ts')
			await writeFile(manifest, source)

			const proc = Bun.spawnSync({
				cmd: [
					process.execPath,
					resolve(import.meta.dir, 'fixtures/cross-copy-child.ts')
				],
				env: {
					...process.env,
					APP: app,
					MANIFEST: manifest,
					ELYSIA_AOT_BUILD: ''
				},
				stdout: 'pipe',
				stderr: 'pipe'
			})

			expect(proc.exitCode, proc.stderr.toString()).toBe(0)
			return JSON.parse(proc.stdout.toString())
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}

	it('serves a lazy Standard Schema manifest on a cold bridge', async () => {
		expect(
			await runChild(
				'fixtures/lazy-standard-app.ts',
				{
					lazy: true,
					registerFrom: resolve(
						import.meta.dir,
						'../../src/compile/aot.ts'
					),
					routeShapeFrom: resolve(
						import.meta.dir,
						'../../src/compile/handler/route-shape.ts'
					)
				},
				(source) => {
					// the case under test: lazy groups emitted, no builder imported
					expect(source).toContain('lazyGroups')
					expect(source).not.toContain('buildFrozenRouteValidator')
				}
			)
		).toEqual({ live: false, ok: 200, invalid: 422 })
	})

	// replay members from another copy read that copy's registry and classes:
	// on a cold bridge every request to a frozen route answered 500, valid or
	// not. src and dist of this repo are two copies
	it.each([
		[
			'src',
			'../../src/compile/handler/route-shape.ts',
			{ live: false, ok: 200, invalid: 422 }
		],
		[
			'dist',
			'../../dist/compile/handler/route-shape.mjs',
			{
				load: '[elysia-aot] `elysia` and `elysia/route-shape` resolve to different copies of elysia: check aliases and duplicate installs, or the `registerFrom` / `routeShapeFrom` options'
			}
		]
	])('routeShapeFrom on %s', async (_, routeShapeFrom, expected) => {
		expect(
			await runChild(
				'fixtures/cross-copy-app.ts',
				{
					registerFrom: resolve(
						import.meta.dir,
						'../../src/compile/aot.ts'
					),
					routeShapeFrom: resolve(import.meta.dir, routeShapeFrom)
				},
				(source) => {
					expect(source).toContain('buildFrozenRouteValidator')
					expect(source).toContain('resolveHandlerParams')
				}
			)
		).toEqual(expected)
	})
})
