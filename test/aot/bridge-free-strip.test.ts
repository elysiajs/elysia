import { describe, it, expect, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import * as esbuild from 'esbuild'
import * as tb from 'typebox/type'

/** Published bundles validate without TypeBox when every validator is frozen. */

const APP = resolve(import.meta.dir, 'fixtures/dist-dedup-app.ts')
const LEAF_DIR = resolve(import.meta.dir, '../../dist/type/elysia')

// Mirror the leaf-only `elysia/type` module emitted by a tree-shaking build.
const OVERRIDES: Record<string, string> = {
	Accelerate: 'accelerate',
	Array: 'array',
	ArrayBuffer: 'array-buffer',
	ArrayString: 'array-string',
	Boolean: 'boolean',
	BooleanString: 'boolean-string',
	Cookie: 'cookie',
	Date: 'date',
	File: 'file',
	Files: 'files',
	Form: 'form',
	Integer: 'integer',
	IntegerString: 'integer-string',
	Intersect: 'intersect',
	MaybeEmpty: 'maybe-empty',
	NoValidate: 'no-validate',
	Nullable: 'nullable',
	Number: 'number',
	Numeric: 'numeric',
	NumericEnum: 'numeric-enum',
	Object: 'object',
	ObjectString: 'object-string',
	Optional: 'optional',
	String: 'string',
	Uint8Array: 'uint8-array',
	Union: 'union',
	UnionEnum: 'union-enum'
}
const LEAF_EXPORT: Record<string, string> = {
	Array: 'ArrayType',
	ArrayBuffer: 'ArrayBufferType',
	Boolean: 'BooleanType',
	Date: 'DateType',
	Number: 'NumberType',
	Object: 'ObjectType',
	String: 'StringType',
	Uint8Array: 'Uint8ArrayType'
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
				() => ({
					contents: `export function setupTypebox(){}\n`,
					loader: 'js'
				})
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

async function loadBundle(code: string) {
	dir ??= mkdtempSync(join(tmpdir(), 'ely-bridge-free-strip-'))
	const file = join(dir, `bundle-${bundleId++}.mjs`)
	writeFileSync(file, code)
	return import(file)
}

describe('published bundle without the TypeBox bridge', () => {
	it('validates requests with setupTypebox stubbed out of the bundle', async () => {
		const code = await buildStripped()

		const mod = await loadBundle(code)
		const app = mod.app ?? mod.default

		const ok = await app.handle(new Request('http://localhost/'))
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('hi')

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)
	})

	it('keeps TypeBox below the stripped-bundle size ceiling', async () => {
		const code = await buildStripped()

		const min = Buffer.byteLength(code)
		const gz = gzipSync(code, { level: 9 }).length

		expect(min).toBeLessThan(160_000)
		expect(gz).toBeLessThan(50_000)
	})
})
