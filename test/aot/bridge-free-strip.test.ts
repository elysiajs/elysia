import { describe, it, expect, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import * as esbuild from 'esbuild'
import * as tb from 'typebox/type'

/**
 * Build-level regression: a frozen app whose validators are fully baked must
 * still VALIDATE requests when `setupTypebox`/compat is stripped from the bundle.
 *
 * WHY this test uses a real `dist` build (not `../../src`): the stripped-bridge
 * failure only manifests through the published module graph. The AOT plugin bakes
 * the validator manifest; a build then replaces `type/compat` with a no-op
 * `setupTypebox` (as a treeshaking build would, to drop TypeBox entirely) and
 * points `elysia/type` at leaf modules that never call `setupTypebox`. With the
 * bridge never wired, the FIRST request to `/u` used to 500 with "Typebox module
 * isn't initialized" — because `Reconstrct.validator` went unconditionally
 * through the bridge-backed `RouteValidator`. The bridge-free reconstruction path
 * rescues it. Against `src`, extensionless resolution and an always-wired bridge
 * hide the whole scenario — which is exactly why a src test would be blind.
 *
 * WHY the fixture imports bare `elysia` + the plugin loads from `elysia/plugin`:
 * capture only succeeds when the app and the plugin share ONE `Compiled`
 * instance (the dist one). A src plugin would capture 0 validators and bake
 * nothing. This depends on `dist` being current — the gate builds it first.
 */

const APP = resolve(import.meta.dir, 'fixtures/dist-dedup-app.ts')
const LEAF_DIR = resolve(import.meta.dir, '../../dist/type/elysia')

// Elysia's leaf types override a subset of TypeBox's `t.*`; the rest pass through
// to `typebox/type`. Mirrors the virtual `elysia/type` a treeshaking build emits.
const OVERRIDES: Record<string, string> = {
	Accelerate: 'accelerate', Array: 'array', ArrayBuffer: 'array-buffer',
	ArrayString: 'array-string', Boolean: 'boolean', BooleanString: 'boolean-string',
	Cookie: 'cookie', Date: 'date', File: 'file', Files: 'files', Form: 'form',
	Integer: 'integer', IntegerString: 'integer-string', Intersect: 'intersect',
	MaybeEmpty: 'maybe-empty', NoValidate: 'no-validate', Nullable: 'nullable',
	Number: 'number', Numeric: 'numeric', NumericEnum: 'numeric-enum',
	Object: 'object', ObjectString: 'object-string', Optional: 'optional',
	String: 'string', Uint8Array: 'uint8-array', Union: 'union', UnionEnum: 'union-enum'
}
const LEAF_EXPORT: Record<string, string> = {
	Array: 'ArrayType', ArrayBuffer: 'ArrayBufferType', Boolean: 'BooleanType',
	Date: 'DateType', Number: 'NumberType', Object: 'ObjectType',
	String: 'StringType', Uint8Array: 'Uint8ArrayType'
}

function virtualType(): string {
	const overrideSet = new Set(Object.keys(OVERRIDES))
	const passthrough = Object.keys(tb).filter((k) => !overrideSet.has(k))

	let src = `export { ${passthrough.join(', ')} } from 'typebox/type'\n`
	for (const [name, leaf] of Object.entries(OVERRIDES)) {
		const exported = LEAF_EXPORT[name] ?? name
		const spec = `${LEAF_DIR}/${leaf}.mjs`
		src +=
			exported === name
				? `export { ${name} } from '${spec}'\n`
				: `export { ${exported} as ${name} } from '${spec}'\n`
	}
	return src
}

// Point `elysia/type` at the virtual module (never calls setupTypebox) and stub
// `type/compat` so `setupTypebox` becomes a no-op — the bridge is never wired.
const stripBridgePlugin = (): esbuild.Plugin => {
	const vt = virtualType()
	return {
		name: 'strip-bridge',
		setup(build) {
			build.onResolve({ filter: /^elysia\/type$/ }, () => ({
				path: 'elysia-type',
				namespace: 'vt'
			}))
			build.onLoad({ filter: /.*/, namespace: 'vt' }, () => ({
				contents: vt,
				loader: 'js',
				resolveDir: resolve(import.meta.dir, '../..')
			}))
			build.onLoad(
				{ filter: /[\\/]dist[\\/]type[\\/]compat\.mjs$/ },
				() => ({ contents: `export function setupTypebox(){}\n`, loader: 'js' })
			)
		}
	}
}

async function buildStripped(): Promise<string> {
	const { aot } = await import('elysia/plugin/aot/esbuild')

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await esbuild.build({
			entryPoints: [APP],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			minify: true,
			external: ['node:*'],
			logLevel: 'silent',
			plugins: [aot(APP), stripBridgePlugin()]
		})
		return result.outputFiles[0]!.text
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

let dir: string | undefined
let bundleId = 0

afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true })
})

// Write the emitted bundle to a temp `.mjs` and import it (Bun rejects an
// over-long `data:` specifier).
async function loadBundle(code: string) {
	dir ??= mkdtempSync(join(tmpdir(), 'ely-bridge-free-strip-'))
	const file = join(dir, `bundle-${bundleId++}.mjs`)
	writeFileSync(file, code)
	return import(file)
}

describe('bridge-free strip build (dist)', () => {
	it('validates requests with setupTypebox stubbed out of the bundle', async () => {
		const code = await buildStripped()

		const mod = await loadBundle(code)
		const app = mod.app ?? mod.default

		const ok = await app.handle(new Request('http://localhost/'))
		expect(ok.status).toBe(200)
		expect(await ok.text()).toBe('hi')

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		// pre-fix: this was a 500 "Typebox module isn't initialized"
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		// correct 422 (fail-closed) even though TypeBox `Errors` is severed
		expect(invalid.status).toBe(422)
	})

	it('keeps TypeBox collapsed (the whole point of stubbing compat)', async () => {
		const code = await buildStripped()

		const min = Buffer.byteLength(code)
		const gz = gzipSync(code, { level: 9 }).length

		// A wired build of this app is ~275KB min / ~82KB gz (TypeBox retained).
		// With compat stubbed and the frozen validators bridge-free, TypeBox must
		// stay collapsed — assert a generous ceiling well below the wired size so
		// a future regression that drags TypeBox back in trips this.
		expect(min).toBeLessThan(160_000)
		expect(gz).toBeLessThan(50_000)
	})
})
