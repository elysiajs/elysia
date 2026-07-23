// Build-time only implementation
import { Compile, Build } from 'typebox/schema'
import type { TSchema } from 'typebox/type'
import { Default } from 'typebox/value'
import createMirror from 'exact-mirror'

import {
	aotActivationError,
	Capture,
	captureImpl,
	CompilerState,
	setCaptureImpl,
	type CaptureImpl,
	type CapturedWSRoute,
	type CapturedValidator,
	type CheckBuildResult,
	type CompiledSnapshot,
	type CompilerSession,
	type ValidatorSlot
} from './aot'

import { buildCoercedFromPlan, captureCoercePlan } from '../type/coerce'
import { buildFrozenCheck } from '../type/validator/frozen-check'
import { captureCustomErrors } from '../type/validator/custom-error'
import { captureStringCodecEntries } from '../type/validator/string-codec-aot'
import {
	applyPrecomputed,
	buildDefaultClonerSource,
	buildObjectDefaultMergeSource,
	canonical,
	createMergerFromSource,
	setDefaultProbeImpl,
	verifyPreallocatableDefault
} from '../type/validator/default-precompute'
import {
	isCapturedBridgeFree,
	isCompactDiagnosable
} from './handler/frozen-validator'
import { isAsyncPredicate } from '../type/elysia/file-type'
import { nullObject } from '../utils'
import { collectExternals } from './aot-reconstruct'
import {
	captureMirrorCodecs,
	captureMirrorUnions,
	installReconstructImpl
} from './aot-emit'

// ─── capture-only default-precompute probes ────────────────────────────────
// Moved out of src/type/validator/default-precompute.ts (runtime graph) and
// injected back via `setDefaultProbeImpl`; only `validate=true` (capturing)
// paths ever reach them.

function emptyContainers(node: any, depth: number): unknown {
	if (depth <= 0 || !node || typeof node !== 'object') return
	const kind = node['~kind']

	if (kind === 'Object' || node.type === 'object') {
		const out: Record<string, unknown> = nullObject()

		const props = node.properties ?? nullObject()
		for (const key in props)
			if (Object.hasOwn(props, key)) {
				const child = emptyContainers(props[key], depth - 1)
				if (child !== undefined) out[key] = child
			}
		return out
	}

	if (
		(kind === 'Array' || node.type === 'array') &&
		node.items &&
		!Array.isArray(node.items)
	) {
		const element = emptyContainers(node.items, depth - 1)
		return element === undefined ? [] : [element]
	}
}

// Build-time probes for `validateMergeSource`: empty containers, a fully-nested
// fill, and a present sentinel at each top-level slot (passthrough must not be
// clobbered by a default).
function* mergeProbes(schema: any): Generator<unknown> {
	yield {}
	yield []

	const filled = emptyContainers(schema, 6)
	if (filled !== undefined) yield filled

	const kind = schema['~kind']
	if (kind === 'Object' || schema.type === 'object') {
		const props = schema.properties ?? nullObject()
		for (const key in props)
			if (Object.hasOwn(props, key)) {
				yield { [key]: PROBE_SENTINEL }
				const child = emptyContainers(props[key], 6)
				if (child !== undefined) yield { [key]: child }
			}
	} else if (
		(kind === 'Array' || schema.type === 'array') &&
		schema.items &&
		!Array.isArray(schema.items)
	) {
		yield [PROBE_SENTINEL]
		const element = emptyContainers(schema.items, 6)
		if (element !== undefined) yield [element, element]
	}
}

function validateMergeSource(schema: TSchema, source: string): boolean {
	const merger = createMergerFromSource(source)
	if (!merger) return false

	for (const probe of mergeProbes(schema)) {
		// the runtime only invokes the merger for present, non-null object/array
		if (probe === null || typeof probe !== 'object') continue

		let expected: unknown
		try {
			expected = Default(schema, structuredClone(probe))
		} catch {
			return false
		}

		let actual: unknown
		try {
			actual = merger(structuredClone(probe))
		} catch {
			return false
		}

		if (canonical(expected) !== canonical(actual)) return false
	}

	return true
}

const PROBE_SENTINEL = '__elysia_default_probe__'

function* defaultProbes(
	pod: Record<string, unknown> | undefined
): Generator<Record<string, unknown>> {
	if (!pod) return
	yield {}

	for (const k in pod) {
		yield { [k]: PROBE_SENTINEL }

		const d = pod[k]
		if (d && typeof d === 'object' && !Array.isArray(d)) {
			yield { [k]: {} }

			for (const k2 in d as Record<string, unknown>) {
				yield { [k]: { [k2]: PROBE_SENTINEL } }
				break
			}
		}
	}
}

function validateObjectDefault(
	schema: TSchema,
	pod: Record<string, unknown>
): boolean {
	for (const probe of defaultProbes(pod)) {
		let expected: unknown
		try {
			expected = Default(schema, structuredClone(probe))
		} catch {
			return false
		}

		const actual = applyPrecomputed(pod, structuredClone(probe))
		if (canonical(expected) !== canonical(actual)) return false
	}

	return true
}

setDefaultProbeImpl({ validateMergeSource, validateObjectDefault })

// ───────────────────────────────────────────────────────────────────────────

function externalsShape(schema: unknown) {
	let out = ''
	for (const e of collectExternals(schema))
		out += e instanceof RegExp ? 'r' : typeof e === 'function' ? 'f' : 'v'

	return out
}

function sourceOnlyValidator(schema: TSchema) {
	const buildResult = Build(schema)
	let full: any | undefined

	return new Proxy({} as any, {
		get(_, prop) {
			if (prop === 'buildResult') return buildResult

			const f = (full ??= Compile(schema))
			const value = (f as any)[prop]

			return typeof value === 'function' ? value.bind(f) : value
		}
	})
}

function maybeCapture(args: {
	aot: { method: string; path: string }
	slot: ValidatorSlot
	hasRef: boolean
	originalSchema: any
	schema: any
	hasCodec: boolean
	hasDefault: boolean
	coerces: unknown
	normalize: boolean | 'exactMirror' | 'typebox' | undefined
	sanitize: unknown
	buildResult: CheckBuildResult
}) {
	const {
		aot,
		slot,
		hasRef,
		originalSchema,
		schema,
		hasCodec,
		hasDefault,
		coerces,
		normalize,
		buildResult
	} = args
	const captured: Partial<CapturedValidator> = {
		precomputeSafe: undefined,
		precomputedDefault: undefined,
		precomputeNull: undefined,
		precomputedObjectDefault: undefined,
		defaultCloner: undefined,
		objectDefaultMerger: undefined
	}

	if (
		hasCodec &&
		!hasRef &&
		coerces &&
		normalize !== false &&
		normalize !== 'typebox'
	) {
		const plan = captureCoercePlan(originalSchema, schema)
		if (
			plan &&
			externalsShape(buildCoercedFromPlan(originalSchema, plan)) ===
				externalsShape(schema)
		)
			captured.coercePlan = plan
	}

	if (hasDefault) {
		const defaults = verifyPreallocatableDefault(schema as TSchema)
		if (defaults) {
			captured.precomputeSafe = true
			captured.precomputedDefault = defaults.pd
			captured.precomputeNull = defaults.pn
			captured.precomputedObjectDefault = defaults.pod
			captured.defaultCloner =
				defaults.pd !== undefined
					? buildDefaultClonerSource(defaults.pd)
					: undefined

			captured.objectDefaultMerger =
				defaults.ms ??
				(defaults.pod !== undefined
					? buildObjectDefaultMergeSource(defaults.pod)
					: undefined)
		}
	}

	const customErrors = captureCustomErrors(schema)
	if (customErrors) captured.customErrors = customErrors

	const innerCodecs = captureStringCodecEntries(
		schema as TSchema,
		args.sanitize as any
	)
	if (innerCodecs) captured.innerCodecs = innerCodecs

	const cf = buildFrozenCheck(buildResult, schema)
	if (cf)
		Object.assign(captured, {
			...cf,
			async: buildResult.external.variables.some(isAsyncPredicate),
			hasDefault,
			hasCodec,
			hasRef
		})

	Capture.set({ method: aot.method, path: aot.path, slot }, captured)
}

function captureMirror(
	schema: any,
	aot: { method: string; path: string },
	slot: ValidatorSlot,
	sanitize: unknown
) {
	try {
		const emitted = createMirror(schema, {
			Compile,
			sanitize: sanitize as any,
			emit: true
		}) as { source?: string; externals?: any }

		if (typeof emitted?.source === 'string') {
			const ext = emitted.externals

			if (!ext)
				Capture.set(
					{ method: aot.method, path: aot.path, slot },
					{
						mirror: {
							source: emitted.source,
							hasExternals: false
						}
					}
				)
			else if (ext.unions && !ext.hof) {
				const u = captureMirrorUnions(schema, ext.unions)

				if (u)
					Capture.set(
						{ method: aot.method, path: aot.path, slot },
						{
							mirror: {
								source: emitted.source,
								hasExternals: true,
								u
							}
						}
					)
			}
		}
	} catch {}
}

function captureCodecMirror(
	schema: any,
	aot: { method: string; path: string },
	slot: ValidatorSlot,
	sanitize: unknown,
	dir: 'decode' | 'encode'
) {
	const dirOpt = dir === 'decode' ? { decode: true } : { encode: true }

	try {
		const emitted = createMirror(schema, {
			Compile,
			sanitize: sanitize as any,
			...dirOpt,
			emit: true
		}) as { source?: string; externals?: any }

		if (typeof emitted?.source === 'string') {
			const ext = emitted.externals

			if (
				ext?.codecs &&
				!ext.hof &&
				captureMirrorCodecs(schema, ext.codecs, dir)
			) {
				let u: { identifier: string; code: string }[][] | undefined
				let freezable = true

				if (ext.unions && ext.unions.length) {
					u = captureMirrorUnions(schema, ext.unions)
					if (!u) freezable = false
				}

				if (freezable) {
					const mirror = {
						source: emitted.source,
						hasExternals: true,
						u
					}
					Capture.set(
						{ method: aot.method, path: aot.path, slot },
						dir === 'decode'
							? { decodeMirror: mirror }
							: { encodeMirror: mirror }
					)
				}
			}
		}
	} catch {}
}

// sealed slots whose schema carries a coercion/codec node
const compactErrorWarned = new Set<string>()

// @internal test isolation
export function resetCompactErrorWarnings() {
	compactErrorWarned.clear()
}

function warnCompactErrorLoss(
	aot: { method: string; path: string },
	slot: ValidatorSlot
) {
	const key = `${aot.method}\0${aot.path}\0${slot}`
	if (compactErrorWarned.has(key)) return
	compactErrorWarned.add(key)

	console.warn(
		`[elysia-aot]: sealed validator for ${aot.method} ${aot.path} (${slot}) ` +
			`carries a coercion/codec schema; its 422 error detail will name the ` +
			`offending field coarsely (best-effort) instead.`
	)
}

function captureBridgeFree(
	aot: { method: string; path: string },
	slot: ValidatorSlot,
	rawSchema: unknown
) {
	const captured = Capture.get({
		method: aot.method,
		path: aot.path,
		slot
	})

	if (captured) {
		const coerced =
			captured.coercePlan && typeof rawSchema !== 'string'
				? buildCoercedFromPlan(rawSchema as any, captured.coercePlan)
				: rawSchema

		const bridgeFree = isCapturedBridgeFree(captured, rawSchema, coerced)

		Capture.set(
			{ method: aot.method, path: aot.path, slot },
			{ bridgeFree }
		)

		if (bridgeFree && !isCompactDiagnosable(coerced))
			warnCompactErrorLoss(aot, slot)
	}
}

// The rest are for build/test-only

// @internal test isolation
export function beginValidatorCapture() {
	if (captureImpl === undefined) throw aotActivationError

	const active = CompilerState.session
	if (active?.capture !== undefined) {
		if (active.explicitCapture)
			throw new Error(
				'[elysia-aot]: A capture session is already active.'
			)

		active.explicitCapture = true
		return
	}

	if (active && !active.external)
		throw new Error('[elysia-aot]: A compiler session is already active.')

	const session =
		active ?? (CompilerState.session = CompilerState.newSession())
	session.external = true
	session.explicitCapture = true
	session.capture = new Map()
	session.captureRoutes = new Set()
}

export function abortCapture() {
	const session = CompilerState.session
	if (!session?.external) return

	session.capture = undefined
	session.wsCapture = undefined
	session.captureRoutes = undefined
	session.sucroseCache.clear()
	CompilerState.session = undefined
}

function endCaptureSession(session: CompilerSession) {
	if (
		session.external &&
		!session.app &&
		!session.capture &&
		!session.wsCapture
	) {
		session.sucroseCache.clear()
		CompilerState.session = undefined
	}
}

// @internal test isolation
export function endValidatorCapture() {
	const session = CompilerState.session
	const captured = session?.capture ? [...session.capture.values()] : []
	if (session) {
		session.capture = undefined
		session.captureRoutes = undefined
		endCaptureSession(session)
	}

	return captured
}

export function endWSCapture(): CapturedWSRoute[] {
	const session = CompilerState.session
	const captured = session?.wsCapture ? [...session.wsCapture.values()] : []

	if (session) {
		session.wsCapture = undefined
		endCaptureSession(session)
	}

	return captured
}

/** @internal deterministic session/capture assertions. */
export const getCompilerSessionDiagnostics = () => {
	const session = CompilerState.session

	return {
		active: session !== undefined,
		appAttached: session?.app !== undefined,
		validators: session?.capture?.size ?? 0,
		wsRoutes: session?.wsCapture?.size ?? 0,
		sucrose: session?.sucroseCache.size ?? 0
	}
}

/** @internal preserve registry around in-process AOT analysis */
export const snapshotCompiled = () => CompilerState.registry

/** @internal restore registry after in-process AOT analysis */
export function restoreCompiled(snapshot: CompiledSnapshot) {
	CompilerState.registry = snapshot
}

const impl: CaptureImpl = {
	sourceOnlyValidator,
	maybeCapture,
	captureMirror,
	captureCodecMirror,
	captureBridgeFree
}

setCaptureImpl(impl)
// capture consumes the reconstruction table (`isCapturedBridgeFree`,
// frozen replay), so wiring one without the other is never valid
installReconstructImpl()

export { impl as captureImplementation }
