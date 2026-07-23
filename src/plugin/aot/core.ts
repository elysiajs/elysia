import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { captureArtifacts, type AotTarget } from './source'
import { composeRouteHook } from '../../compile/handler'
import {
	isResponseMap,
	isStandardSchema,
	resolveModelRef,
	standaloneAllStandard
} from '../../compile/handler/frozen-validator'
import type { AnyElysia } from '../../base'

/**
 * Import schema constructors from `elysia/type` when constructor-level
 * tree-shaking is needed. The AOT plugin does not rewrite application imports.
 */
export interface ElysiaAotOptions {
	/**
	 * Specifier the generated module imports `Compiled` from
	 * Must resolve to the same `elysia` instance the app runs
	 *
	 * @default 'elysia'
	 */
	registerFrom?: string

	/**
	 * Specifier the generated module imports the `Reconstruct` table from.
	 * Pure — any elysia copy works (registration goes through `Compiled`)
	 *
	 * @default 'elysia/reconstruct'
	 */
	reconstructFrom?: string

	/**
	 * Specifier providing the frozen WebSocket runtime used by emitted WS images.
	 *
	 * @default 'elysia/ws/runtime'
	 */
	wsRuntimeFrom?: string

	/**
	 * Deploy target for build-time-baked codegen consts (the response-header
	 * path). Set `target: 'workerd'` to build under Bun yet ship a manifest
	 * valid on Cloudflare Workers / Node.
	 *
	 * @default the build runtime
	 */
	target?: AotTarget

	/**
	 * Treat this as a production build, making `isProduction` a compile-time
	 * constant `true` so bundlers can DCE `!isProduction()` branches.
	 *
	 * - `true` (default): stub `isProduction` as `() => true` so dev-verbose
	 *   error paths tree-shake
	 * - `false`: leave `isProduction` as a runtime env read (preserves dev
	 *   behaviour in the bundle)
	 *
	 * @default true
	 */
	production?: boolean
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

export const adapterConstantsSource = (
	target: 'bun' | 'web-standard'
): string =>
	target === 'bun'
		? `import { BunAdapter } from './bun/index'\nexport const getDefaultAdapter = () => BunAdapter\n`
		: `import { WebStandardAdapter } from './web-standard/index'\nexport const getDefaultAdapter = () => WebStandardAdapter\n`

export const ADAPTER_CONSTANTS_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]adapter[\\/]constants\.(m?js|ts)$/

export const IS_PRODUCTION_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]universal[\\/]is-production\.(m?js|ts)$/

export const TYPE_EXPORTS_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]type[\\/]exports\.(m?js|ts)$/

/**
 * A direct AOT image carries its validator programs, so loading the authoring
 * schema constructors must not install the runtime TypeBox bridge. Transform
 * only the `elysia/type` implementation; explicit `elysia/type-system` setup
 * remains unchanged.
 */
export function omitTypeboxSetup(source: string): string {
	const importPattern =
		/^import\s*\{\s*setupTypebox\s*\}\s*from\s*(['"])\.\/compat(?:\.(?:m?js|cjs))?\1;?\r?\n/m
	if (importPattern.test(source)) {
		const withoutImport = source.replace(importPattern, '')
		const withoutCall = withoutImport.replace(
			/^setupTypebox\(\);?\r?\n/m,
			''
		)
		if (withoutCall === withoutImport)
			throw new Error(
				'[elysia-aot] elysia/type setup call does not match the direct-image transform'
			)

		return withoutCall
	}

	const requirePattern =
		/^(?:const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\((['"])\.\/compat(?:\.(?:m?js|cjs))?\2\);?\r?\n/m
	const binding = source.match(requirePattern)?.[1]
	if (!binding)
		throw new Error(
			'[elysia-aot] elysia/type setup import does not match the direct-image transform'
		)

	const withoutImport = source.replace(requirePattern, '')
	const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const withoutCall = withoutImport.replace(
		new RegExp(`^${escaped}\\.setupTypebox\\(\\);?\\r?\\n`, 'm'),
		''
	)
	if (withoutCall === withoutImport)
		throw new Error(
			'[elysia-aot] elysia/type setup call does not match the direct-image transform'
		)

	return withoutCall
}

/**
 * Loose fallback filter — matches the `/elysia/(dist|src)/` segment anywhere in
 * a path (node_modules layouts, monorepos, linked installs). Used by esbuild as
 * a broad pre-filter; the caller must further check that the path is under the
 * resolved elysia package root to avoid matching user code in a directory that
 * happens to be named "elysia".
 *
 * @internal
 */
export const ELYSIA_MODULE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/].+\.(m?js|ts)x?$/

/**
 * Build a predicate that returns `true` only for modules that are under the
 * resolved elysia package root (i.e. actually elysia's own files).
 *
 * Anchoring to the real package root prevents user projects rooted in a
 * directory named `elysia` (like this repo itself) from having their code
 * rewritten.
 *
 * The transform hooks use the result to identify Elysia modules.
 */
export function resolveElysiaRoot(from: string = process.cwd()): string {
	try {
		const req = createRequire(join(from, 'package.json'))
		const pkgJson = req.resolve('elysia/package.json')
		return dirname(pkgJson)
	} catch {
		// Fallback for linked/monorepo setups where createRequire may fail: return `from` as-is.
		return from
	}
}

/**
 * Returns a predicate that is `true` only when the given module path is under
 * the resolved elysia package root AND matches the broad module filter.
 */
export function makeIsElysiaModule(
	elysiaRoot: string
): (path: string) => boolean {
	// Normalise to posix for comparison on Windows
	const root = elysiaRoot.replace(/\\/g, '/')
	return (path: string) => {
		const posix = path.replace(/\\/g, '/')
		return (
			posix.startsWith(root + '/src/') ||
			posix.startsWith(root + '/dist/')
		)
	}
}

export function rewriteIsProductionCalls(code: string): string {
	// Negative lookbehind for `.` and `?.` ensures we only rewrite bare
	// identifier call expressions and leave member calls (`x.isProduction()`,
	// `x?.isProduction()`) untouched.
	return code.replace(/(?<![.?])\bisProduction\(\)/g, 'true')
}

export async function generateCompiledModule(
	file: string,
	options?: ElysiaAotOptions
): Promise<string> {
	return (await generateCompiledArtifacts(file, options)).source
}

export interface CompiledArtifacts {
	source: string
}

const assertSupportedAotOptions = (options?: ElysiaAotOptions) => {
	if (
		options &&
		Object.prototype.hasOwnProperty.call(
			options as Record<string, unknown>,
			'strip'
		)
	)
		throw new Error(
			'[elysia-aot] option "strip" was removed; AOT always emits one complete AppPlan image.'
		)
}

const _importedEntries = new Set<string>()

type IsolatedGenerationResult =
	| { ok: true; artifacts: CompiledArtifacts }
	| {
			ok: false
			error: { name: string; message: string; stack?: string }
	  }

const workerUrl = (): URL => {
	const moduleUrl = import.meta.url
	const extension = moduleUrl.endsWith('.mjs')
		? '.mjs'
		: moduleUrl.endsWith('.js')
			? '.js'
			: '.ts'

	return new URL('./worker' + extension, moduleUrl)
}

/** @internal Re-evaluate an entry in a disposable worker for watch rebuilds. */
export async function generateCompiledArtifactsIsolated(
	file: string,
	options?: ElysiaAotOptions
): Promise<CompiledArtifacts> {
	assertSupportedAotOptions(options)
	const entry = resolveEntry(file)

	console.warn(
		'[elysia-aot] re-evaluating "' +
			entry +
			'" in an isolated worker for rebuild. ' +
			'Top-level side effects run only inside the worker.'
	)

	const worker = new Worker(workerUrl(), {
		workerData: { file: entry, options }
	})

	const exit = new Promise<number>((resolve) => worker.once('exit', resolve))

	try {
		return await new Promise<CompiledArtifacts>((resolve, reject) => {
			let received = false

			worker.once('message', (result: IsolatedGenerationResult) => {
				received = true
				if (result.ok) return resolve(result.artifacts)

				const error = new Error(
					`[elysia-aot] isolated rebuild failed for "${entry}": ${result.error.message}`
				)
				error.name = result.error.name
				if (result.error.stack)
					error.stack += '\nCaused by:\n' + result.error.stack
				reject(error)
			})
			worker.once('error', reject)
			worker.once('exit', (code) => {
				if (!received)
					reject(
						new Error(
							`[elysia-aot] isolated rebuild worker for "${entry}" exited with code ${code}`
						)
					)
			})
		})
	} finally {
		try {
			await worker.terminate()
		} finally {
			await exit
		}
	}
}

function typeBoxResponseSlots(response: unknown, root?: AnyElysia) {
	if (root && typeof response === 'string')
		response = resolveModelRef(response, root) ?? response

	if (response == null || isStandardSchema(response)) return []
	if (typeof response !== 'object') return ['response:200']
	if (!isResponseMap(response)) return ['response:200']

	const slots: string[] = []
	for (const [status, raw] of Object.entries(response)) {
		let schema = raw
		if (root && typeof schema === 'string')
			schema = resolveModelRef(schema, root) ?? schema
		if (schema && !isStandardSchema(schema))
			slots.push(`response:${status}`)
	}

	return slots
}

function typeBoxValidatorSlots(
	hooks: Record<string, unknown>,
	root?: AnyElysia
) {
	const slots = typeBoxResponseSlots(hooks.response, root)
	for (const slot of ['body', 'query', 'params', 'headers', 'cookie']) {
		let value = hooks[slot]
		if (root && typeof value === 'string')
			value = resolveModelRef(value, root) ?? value
		if (value && !isStandardSchema(value)) slots.push(slot)
	}

	return slots
}

/** @internal Deterministic coverage count for one canonical route hook. */
export function countTypeBoxValidatorSlots(
	hooks: Record<string, unknown>,
	root?: AnyElysia
) {
	return typeBoxValidatorSlots(hooks, root).length
}

const validatorSlotKey = (method: unknown, path: unknown, slot: unknown) =>
	`${method}\0${path}\0${slot}`

const describeValidatorSlot = (key: string) => {
	const [method, path, slot] = key.split('\0')
	return `${method} ${path} (${slot})`
}

export async function generateCompiledArtifacts(
	file: string,
	options?: ElysiaAotOptions
): Promise<CompiledArtifacts> {
	assertSupportedAotOptions(options)

	const previousAotBuild = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'

	try {
		const entry = resolveEntry(file)
		const entryReal = realPath(entry)

		// Repeated in-process build of the same entry: a plain re-import would
		// hand back the module-cached, already-captured app. Re-evaluate in an
		// isolated worker instead (same path watch rebuilds use).
		if (_importedEntries.has(entryReal))
			return generateCompiledArtifactsIsolated(file, options)

		_importedEntries.add(entryReal)
		const mod = (await import(entry)) as {
			app?: unknown
			default?: unknown
		}

		const app = mod.app ?? mod.default

		if (
			!app ||
			typeof (app as { compile?: unknown }).compile !== 'function'
		)
			throw new Error(`[elysia-aot] "${entry}" must export an Elysia app`)

		const typedApp = app as Parameters<typeof captureArtifacts>[0]
		const sourceOptions = {
			register: true,
			registerFrom: options?.registerFrom,
			reconstructFrom: options?.reconstructFrom,
			wsRuntimeFrom: options?.wsRuntimeFrom,
			target: options?.target
		}

		const artifacts = await captureArtifacts(typedApp, sourceOptions)
		if (!artifacts.appPlan)
			throw new Error(
				'[elysia-aot] capture did not produce the required AppPlan image.'
			)

		if (options?.target !== 'workerd')
			return { source: artifacts.source }

		const history = typedApp['~routes'] ?? []

		const expectedSlotKeys = new Set<string>()

		let routesForbidSeal = false
		const winningRoutes = new Map<string, (typeof history)[number]>()
		for (const route of history)
			winningRoutes.set(`${route[0]}\0${route[1]}`, route)

		for (const route of winningRoutes.values()) {
			const [method, path, , instance, hook, appHook, inheritedChain, macroScope] =
				route as [
					unknown,
					unknown,
					unknown,
					unknown,
					unknown,
					unknown,
					unknown,
					unknown
				]
			const hooks = composeRouteHook(
				instance as any,
				hook as any,
				appHook as any,
				inheritedChain as any,
				typedApp as any,
				macroScope as any
			) as Record<string, unknown> | undefined
			if (!hooks) continue

			const routeSlots = typeBoxValidatorSlots(hooks, typedApp)
			const routeHasTypeBoxDirectSlot = routeSlots.length > 0
			for (const slot of routeSlots)
				expectedSlotKeys.add(validatorSlotKey(method, path, slot))

			const standalone = (hooks as { schemas?: unknown[] }).schemas
			if (Array.isArray(standalone) && standalone.length > 0) {
				if (
					routeHasTypeBoxDirectSlot ||
					!standaloneAllStandard(
						standalone as Array<Record<string, unknown>>,
						typedApp
					)
				)
					routesForbidSeal = true
			}
		}

		// `normalize: 'typebox'` need 'typebox/value'
		if (
			(typedApp as { ['~config']?: { normalize?: unknown } })['~config']
				?.normalize === 'typebox'
		)
			routesForbidSeal = true

		const frozenSlots = artifacts.validators.length
		const capturedSlotKeys = new Set(
			artifacts.validators.map((validator) =>
				validatorSlotKey(
					validator.method,
					validator.path,
					validator.slot
				)
			)
		)
		const slotKeysMatch =
			capturedSlotKeys.size === expectedSlotKeys.size &&
			[...expectedSlotKeys].every((key) => capturedSlotKeys.has(key))

		if (!slotKeysMatch) {
			const missing = [...expectedSlotKeys].filter(
				(key) => !capturedSlotKeys.has(key)
			)
			const unexpected = [...capturedSlotKeys].filter(
				(key) => !expectedSlotKeys.has(key)
			)
			throw new Error(
				`[elysia-aot] target 'workerd': captured ${frozenSlots} validator slots ` +
					`but expected ${expectedSlotKeys.size}. ` +
					(missing.length
						? `Missing: ${missing.map(describeValidatorSlot).join(', ')}. `
						: '') +
					(unexpected.length
						? `Unexpected: ${unexpected.map(describeValidatorSlot).join(', ')}. `
						: '') +
					`The AppPlan image must exactly cover the app because runtime compilation is unavailable on workerd.`
			)
		}

		if (
			routesForbidSeal ||
			artifacts.validators.some((validator) => !validator.bridgeFree)
		)
			throw new Error(
				`[elysia-aot] target 'workerd' requires every TypeBox validator ` +
					`to have a complete bridge-free AppPlan image. Runtime TypeBox compilation is unavailable on workerd.`
			)

		return { source: artifacts.source }
	} finally {
		if (previousAotBuild === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

// eslint-disable-next-line sonarjs/single-character-alternation
export const SOURCE_REGEX = /\.(c|m)?(t|j)sx?$/

export const realPath = (path: string): string => {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}
