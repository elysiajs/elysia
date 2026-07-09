import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import * as esbuild from 'esbuild'

// Slim replay — SLICE 3: structural extraction + stubs.
//
// The full `#buildRouter` route-scan / model-ref assert / variant-derivation /
// per-route-compile graph was extracted into `compile/build-router.ts`. When the
// build emits a frozen route table manifest (mode === 'sealed' && routeTable), the
// runtime `#replayRouter` binds `~map` directly and that whole module is dead — so
// STUB_SOURCES replaces it with a throwing stub. That's the byte win.
//
// These tests pin the two sides of the gate through the REAL plugin build:
//  1. sealed + routeTable → stub applied: the bundle must NOT retain the
//     distinctive model-ref assert string ("Unknown model reference") that only
//     exists inside build-router, and the app must still SERVE correctly (the
//     runtime slim replay does the routing).
//  2. routeTable bailed (a Standard-Schema route — slice 4 covers schema/dynamic
//     routes now, so the bail case is a conservatively-bailed `~standard` slot)
//     → stub NOT applied: the bundle RETAINS the builder, and the app still
//     serves through the live full builder.
// Plus: stub-plan derivation, and vite parity (a prior defect was a vite
// omission of a stub key, so parity is a standing rule).
//
// WHY dist core (not src): the stub plan must be read from the SAME dist
// instance the fixtures' bare `elysia` import resolves to, or the handler-JIT
// replay runs against a different `Compiled` and mis-reports `jit`. See
// mode-gating.test.ts for the full rationale.
//
// @see design/slim-replay.md

const distCore = (await import(
	resolve(import.meta.dir, '../../dist/plugin/core.mjs')
)) as typeof import('../../src/plugin/core')
const { generateCompiledArtifacts, STUB_SOURCES } = distCore

const SEALED = resolve(import.meta.dir, 'fixtures/slim-route-table-app.ts')
const WIDENED = resolve(import.meta.dir, 'fixtures/slim-route-table-widened-app.ts')
const BAIL = resolve(import.meta.dir, 'fixtures/slim-route-table-bail-app.ts')

// The distinctive builder-only marker: this error string is thrown by
// `assertRouteModelRefs`, which lives ONLY inside build-router. If the module is
// stubbed out, the string must be gone from the bundle. If the builder is live
// (bail), it must be present.
const BUILDER_MARKER = 'Unknown model reference'
// The stub's own error string — present only when the stub landed.
const STUB_MARKER = 'the full router builder was stripped'

async function buildEsbuild(app: string): Promise<string> {
	const { aot } = await import('elysia/plugin/esbuild')
	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await esbuild.build({
			entryPoints: [app],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			minify: true,
			external: ['node:*'],
			logLevel: 'silent',
			plugins: [aot(app, { production: false })]
		})
		return result.outputFiles[0]!.text
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

let dir: string
const code: Record<string, string> = {}
const appPath: Record<string, string> = {}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'ely-slim-stub-'))

	code.sealed = await buildEsbuild(SEALED)
	code.widened = await buildEsbuild(WIDENED)
	code.bail = await buildEsbuild(BAIL)

	// Release the esbuild service before any dynamic import (see mode-gating
	// header: importing a freshly-written .mjs with the service alive spuriously
	// fails "Cannot find module").
	await esbuild.stop()

	for (const label of Object.keys(code)) {
		const file = join(dir, `${label}.mjs`)
		writeFileSync(file, code[label]!)
		appPath[label] = file
	}
})

afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true })
})

async function loadApp(label: string) {
	const mod = (await import(appPath[label]!)) as { app?: any; default?: any }
	return mod.app ?? mod.default
}

describe('slim-replay slice 3 — stub plan derivation', () => {
	it('sealed + routeTable → buildRouter stub is planned', async () => {
		const { mode, stub } = await generateCompiledArtifacts(SEALED)
		expect(mode).toBe('sealed')
		expect(stub.buildRouter).toBe(true)
	})

	it('sealed + routeTable (widened: loose + autoHead) → stub is planned', async () => {
		const { mode, stub } = await generateCompiledArtifacts(WIDENED)
		expect(mode).toBe('sealed')
		expect(stub.buildRouter).toBe(true)
	})

	it('routeTable bailed (standard-schema route) → buildRouter stub is NOT planned', async () => {
		// The app still seals (all handlers frozen, jit true) but the `~standard`
		// slot makes `captureRouteTable` conservatively bail, so no routeTable is
		// emitted → the full builder must stay live.
		const { mode, stub } = await generateCompiledArtifacts(BAIL)
		expect(mode).toBe('sealed')
		expect(stub.buildRouter).toBe(false)
	})

	it('strip:false → buildRouter stub is NOT planned', async () => {
		const { stub, mode } = await generateCompiledArtifacts(SEALED, {
			strip: false
		})
		expect(mode).toBe('off')
		expect(stub.buildRouter).toBe(false)
	})
})

describe('slim-replay slice 3 — esbuild bundle (real plugin build)', () => {
	it('sealed bundle drops the builder graph (marker absent, stub present)', () => {
		expect(code.sealed).not.toContain(BUILDER_MARKER)
		expect(code.sealed).toContain(STUB_MARKER)
	})

	it('widened sealed bundle drops the builder graph too', () => {
		expect(code.widened).not.toContain(BUILDER_MARKER)
		expect(code.widened).toContain(STUB_MARKER)
	})

	it('bail bundle RETAINS the builder graph (marker present, stub absent)', () => {
		// routeTable bailed → full builder live → the model-ref assert string is
		// still in the bundle and the throwing stub was never substituted.
		expect(code.bail).toContain(BUILDER_MARKER)
		expect(code.bail).not.toContain(STUB_MARKER)
	})

	it('E2E: sealed+stubbed bundle SERVES requests via slim replay', async () => {
		const app = await loadApp('sealed')

		// Routes come from the composed child (/a, /b) + root (/ , /c).
		expect(
			await (
				await app.handle(new Request('http://localhost/'))
			).text()
		).toBe('root')
		expect(
			await (
				await app.handle(new Request('http://localhost/a'))
			).text()
		).toBe('a')
		expect(
			await (
				await app.handle(new Request('http://localhost/c'))
			).text()
		).toBe('c')

		// A route the app never declared must 404 — the frozen route table bound
		// exactly the declared paths, nothing spurious.
		expect(
			(await app.handle(new Request('http://localhost/nope'))).status
		).toBe(404)
	})

	it('E2E: bail bundle serves BOTH static and the standard-schema route via the live builder', async () => {
		const app = await loadApp('bail')

		expect(
			await (
				await app.handle(new Request('http://localhost/'))
			).text()
		).toBe('root')
		expect(
			await (
				await app.handle(new Request('http://localhost/a'))
			).text()
		).toBe('a')
		// The standard-schema route is served through the full builder — this is
		// the path that would 500/throw if the stub had been wrongly applied.
		const res = await app.handle(
			new Request('http://localhost/s', {
				method: 'POST',
				body: JSON.stringify({ hello: 'world' }),
				headers: { 'content-type': 'application/json' }
			})
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ hello: 'world' })
	})
})

describe('slim-replay slice 3 — vite parity', () => {
	// The vite plugin iterates the SAME STUB_SOURCES map in its transform hook, so
	// a new stub key is picked up automatically. Assert that: (a) the entry exists
	// with a filter that matches the dist build-router path, and (b) the vite
	// plugin's transform returns the stub for a sealed+routeTable build and does NOT
	// for a bail build. This guards the standing "no vite omission" rule.
	const buildRouterDistId = resolve(
		import.meta.dir,
		'../../dist/compile/build-router.mjs'
	)

	it('STUB_SOURCES.buildRouter filter matches the dist build-router module path', () => {
		const entries = STUB_SOURCES.buildRouter
		expect(entries.length).toBeGreaterThan(0)
		expect(
			entries.some(({ filter }) => filter.test(buildRouterDistId))
		).toBe(true)
	})

	it('vite transform: sealed+routeTable build → stubs build-router', async () => {
		const { aot } = (await import(
			resolve(import.meta.dir, '../../dist/plugin/vite.mjs')
		)) as typeof import('../../src/plugin/vite')

		const plugin = aot(SEALED, { production: false })
		await plugin.buildStart!()

		const result = await plugin.transform!(
			'export function buildRouter(){/* real graph */}\n',
			buildRouterDistId
		)
		expect(result).toBeDefined()
		expect(result as string).toContain(STUB_MARKER)
	})

	it('vite transform: bail build → does NOT stub build-router', async () => {
		const { aot } = (await import(
			resolve(import.meta.dir, '../../dist/plugin/vite.mjs')
		)) as typeof import('../../src/plugin/vite')

		const plugin = aot(BAIL, { production: false })
		await plugin.buildStart!()

		const result = await plugin.transform!(
			'export function buildRouter(){/* real graph */}\n',
			buildRouterDistId
		)
		// No stub: transform returns undefined or the (possibly rewritten)
		// original, but never the throwing stub source.
		expect((result as string) ?? '').not.toContain(STUB_MARKER)
	})
})
