import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	compileToSource,
	isSealing,
	type AotTarget,
	type SealMode
} from './source'

export { isSealing, type SealMode }

export interface ElysiaAotOptions {
	/**
	 * Specifier the generated module imports `Compiled` from
	 * Must resolve to the same `elysia` instance the app runs
	 *
	 * @default 'elysia'
	 */
	registerFrom?: string

	/**
	 * Materialize route handlers as separate modules and load them lazily
	 *
	 * This can reduce peak memory usage and improve startup time,
	 * but increase latency for the first request to each route
	 *
	 * @default decided by Elysia based on route batch scale
	 */
	lazy?: boolean | number

	/**
	 * Deploy target for build-time-baked codegen consts (the response-header
	 * path). Set `target: 'workerd'` to build under Bun yet ship a manifest
	 * valid on Cloudflare Workers / Node.
	 *
	 * @default the build runtime
	 */
	target?: AotTarget

	/**
	 * Replace `import { t } from 'elysia'` with `import * as t from 'elysia/type'`
	 * at build time so unused TypeBox constructors tree-shake
	 *
	 * @default true
	 */
	treeShake?: boolean

	/**
	 * Seal the build: `define` `globalThis.ELY_SEALED = true`, dropping the
	 * JIT / `Default` / `Errors` / exact-mirror fallback branches (and their
	 * imports) from the bundle.
	 *
	 * - `true`: seal + print the coverage report
	 * - `'silent'`: seal but suppress the report (gaps still fail loud)
	 * - `'audit'`: dry run: print which validators/routes can't be frozen
	 *
	 * @default false
	 */
	seal?: SealMode
}

export const SEAL_DEFINE = { 'globalThis.ELY_SEALED': 'true' } as const

const SEAL_STUB_EXPORTS = {
	value: [
		'Check',
		'Decode',
		'Clean',
		'DecodeUnsafe',
		'Default',
		'Encode',
		'EncodeUnsafe',
		'Errors',
		'HasCodec'
	],
	compile: ['Compile']
} as const

export const SEAL_STUB_FILTER = /^typebox\/(value|compile)$/

export function sealStubSource(specifier: string) {
	const names = specifier.endsWith('compile')
		? SEAL_STUB_EXPORTS.compile
		: SEAL_STUB_EXPORTS.value

	return (
		names.map((name) => `export const ${name} = void 0`).join('\n') +
		'\nexport default {}\n'
	)
}

function findPackageRoot(from: string = process.cwd()) {
	let dir = from

	while (!existsSync(join(dir, 'package.json'))) {
		const parent = dirname(dir)
		if (parent === dir) return from
		dir = parent
	}

	return dir
}

export const resolveEntry = (entry: string): string =>
	resolve(findPackageRoot(), entry)

// Windows part to unix
const toPosix = (path: string) => path.replace(/\\/g, '/')

const ELYSIA_PACKAGE_DIR =
	toPosix(findPackageRoot(dirname(fileURLToPath(import.meta.url)))) + '/'

export const isElysiaImporter = (importer: string | undefined | null) =>
	!!importer && toPosix(importer).startsWith(ELYSIA_PACKAGE_DIR)

export function resolveLoader(entryPath: string) {
	const ext = entryPath.slice(entryPath.lastIndexOf('.'))

	return ext === '.js' || ext === '.mjs' || ext === '.cjs'
		? 'js'
		: ext === '.jsx'
			? 'jsx'
			: ext === '.tsx'
				? 'tsx'
				: 'ts'
}

export const entryFilter = (entryPath: string): RegExp =>
	new RegExp('^' + entryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')

export async function generateCompiledModule(
	file: string,
	options?: ElysiaAotOptions
): Promise<{ source: string; seal: boolean }> {
	process.env.ELYSIA_AOT_BUILD = '1'

	const entry = resolveEntry(file)
	const mod = (await import(entry)) as { app?: unknown; default?: unknown }
	const app = mod.app ?? mod.default

	if (!app || typeof (app as { compile?: unknown }).compile !== 'function')
		throw new Error(`[elysia-aot] "${entry}" must export an Elysia app`)

	// best-effort: `seal` is true only when a sealing mode reached 100% coverage
	let seal = false
	const source = await compileToSource(
		app as Parameters<typeof compileToSource>[0],
		{
			register: true,
			registerFrom: options?.registerFrom,
			lazy: options?.lazy,
			target: options?.target,
			seal: options?.seal,
			onSeal: (s) => (seal = s)
		}
	)

	return { source, seal }
}
