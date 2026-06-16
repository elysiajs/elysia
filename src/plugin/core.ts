import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { compileToSource, type AotTarget } from './source'

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
}

function findPackageRoot(from: string = process.cwd()): string {
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

export function resolveLoader(entryPath: string): 'js' | 'jsx' | 'tsx' | 'ts' {
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
): Promise<string> {
	process.env.ELYSIA_AOT_BUILD = '1'

	const entry = resolveEntry(file)
	const mod = (await import(entry)) as { app?: unknown; default?: unknown }
	const app = mod.app ?? mod.default

	if (!app || typeof (app as { compile?: unknown }).compile !== 'function')
		throw new Error(`[elysia-aot] "${entry}" must export an Elysia app`)

	return compileToSource(app as Parameters<typeof compileToSource>[0], {
		register: true,
		registerFrom: options?.registerFrom,
		lazy: options?.lazy,
		target: options?.target
	})
}
