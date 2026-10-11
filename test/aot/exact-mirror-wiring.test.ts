import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	planFromReport,
	resolveExactMirror,
	STUB_SOURCES
} from '../../src/plugin/aot/core'
import { aot as bunAot } from '../../src/plugin/aot/bun'

/**
 * `type/validator/exact-mirror` loads its package through a runtime `require`,
 * which no bundler can follow — inside a `bun build --compile` binary it never
 * resolves, so every runtime `Validator.create` lost normalization and sanitize.
 * The plugin re-routes the module to its statically imported `-live` mirror so
 * the bundler embeds the package.
 */

const APP = 'test/aot/fixtures/exact-mirror-app.ts'
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
// In-repo sources: the default `elysia/reconstruct` pulls the dist copy into the
// plugin's virtual namespace, where its own relative imports no longer resolve
const RECONSTRUCT_FROM = resolve(
	import.meta.dir,
	'../../src/compile/aot-reconstruct.ts'
)

/** String only `exact-mirror` itself emits, so it proves the package is embedded. */
const EMBEDDED = '[exact-mirror] cyclic reference'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	delete process.env.ELYSIA_AOT_BUILD
})

async function build(strip: boolean | 'auto') {
	const result = await Bun.build({
		entrypoints: [APP],
		plugins: [
			bunAot(APP, {
				registerFrom: REGISTER_FROM,
				reconstructFrom: RECONSTRUCT_FROM,
				strip
			})
		],
		target: 'bun'
	})
	if (!result.success)
		throw new Error(
			`build failed: ${result.logs.map((l) => l.message).join('\n')}`
		)

	return await result.outputs[0]!.text()
}

describe('exact-mirror static wiring', () => {
	it('resolves the package from the elysia root, not from anywhere', () => {
		expect(resolveExactMirror(process.cwd())).toBe(true)

		const empty = mkdtempSync(join(tmpdir(), 'ely-no-mirror-'))
		try {
			expect(resolveExactMirror(empty)).toBe(false)
		} finally {
			rmSync(empty, { recursive: true, force: true })
		}
	})

	it('rewrites the loader module without catching its live mirror', () => {
		const [{ filter }] = STUB_SOURCES.exactMirror

		expect(
			filter.test('/x/elysia/src/type/validator/exact-mirror.ts')
		).toBe(true)
		expect(
			filter.test('/x/elysia/dist/type/validator/exact-mirror.mjs')
		).toBe(true)
		expect(
			filter.test('/x/elysia/dist/type/validator/exact-mirror-live.mjs')
		).toBe(false)
	})

	it('embeds exact-mirror in the bundle', async () => {
		expect(await build(false)).toContain(EMBEDDED)
	})

	// A sealed app emits every mirror into its manifest, so wiring the package
	// would only add ~15KB of dead code to the mode that exists to shrink it.
	it('leaves the loader alone when the app seals', async () => {
		expect(await build('auto')).not.toContain(EMBEDDED)
	})

	it('skips the reroute when the package does not resolve', () => {
		const report = { jit: true, reasons: [] }
		const wired = (exactMirror: boolean) =>
			planFromReport(
				'auto',
				report as any,
				false,
				false,
				new Set(['va']),
				false,
				false,
				false,
				true,
				false,
				exactMirror
			)

		expect(wired(true).mode).toBe('wired')
		expect(wired(true).plan.exactMirror).toBe(true)
		expect(wired(false).plan.exactMirror).toBe(false)
	})
})

describe('exact-mirror live parity', () => {
	it('mirrors the loader module export for export', async () => {
		const loader = await import('../../src/type/validator/exact-mirror')
		const live = await import('../../src/type/validator/exact-mirror-live')

		expect(Object.keys(live).sort()).toEqual(Object.keys(loader).sort())
		expect(live.exactMirrorRequired().message).toBe(
			loader.exactMirrorRequired().message
		)
		expect(typeof live.getExactMirror()).toBe('function')
	})
})
