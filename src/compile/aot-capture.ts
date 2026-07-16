// Build-time only implementation
import { Compile, Build } from 'typebox/schema'
import type { TSchema } from 'typebox/type'
import createMirror from 'exact-mirror'

import {
	Capture,
	setCaptureImpl,
	type CaptureImpl,
	type CheckBuildResult,
	type CapturedValidator,
	type ValidatorSlot
} from './aot'

import { buildCoercedFromPlan, captureCoercePlan } from '../type/coerce'
import { buildFrozenCheck } from '../type/validator/frozen-check'
import { captureCustomErrors } from '../type/validator/custom-error'
import { captureStringCodecEntries } from '../type/validator/string-codec-aot'
import {
	buildDefaultClonerSource,
	buildObjectDefaultMergeSource,
	verifyPreallocatableDefault
} from '../type/validator/default-precompute'
import {
	isCapturedBridgeFree,
	isCompactDiagnosable
} from './handler/frozen-validator'
import { isAsyncPredicate } from '../type/validator/index'
import {
	captureMirrorCodecs,
	captureMirrorUnions,
	collectExternals,
	installReconstructImpl
} from './aot-reconstruct'

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
			Capture.set(
				{ method: aot.method, path: aot.path, slot },
				{ coercePlan: plan }
			)
	}

	const defaultFastPathCapture: Partial<CapturedValidator> = {
		precomputeSafe: undefined,
		precomputedDefault: undefined,
		precomputeNull: undefined,
		precomputedObjectDefault: undefined,
		defaultCloner: undefined,
		objectDefaultMerger: undefined
	}

	if (hasDefault) {
		const defaults = verifyPreallocatableDefault(schema as TSchema)
		if (defaults) {
			defaultFastPathCapture.precomputeSafe = true
			defaultFastPathCapture.precomputedDefault = defaults.pd
			defaultFastPathCapture.precomputeNull = defaults.pn
			defaultFastPathCapture.precomputedObjectDefault = defaults.pod
			defaultFastPathCapture.defaultCloner =
				defaults.pd !== undefined
					? buildDefaultClonerSource(defaults.pd)
					: undefined

			defaultFastPathCapture.objectDefaultMerger =
				defaults.ms ??
				(defaults.pod !== undefined
					? buildObjectDefaultMergeSource(defaults.pod)
					: undefined)
		}
	}

	Capture.set(
		{ method: aot.method, path: aot.path, slot },
		defaultFastPathCapture
	)

	const customErrors = captureCustomErrors(schema)
	if (customErrors)
		Capture.set(
			{ method: aot.method, path: aot.path, slot },
			{ customErrors }
		)

	const innerCodecs = captureStringCodecEntries(
		schema as TSchema,
		args.sanitize as any
	)
	if (innerCodecs)
		Capture.set(
			{ method: aot.method, path: aot.path, slot },
			{ innerCodecs }
		)

	const cf = buildFrozenCheck(buildResult, schema)
	if (!cf) return

	Capture.set(
		{ method: aot.method, path: aot.path, slot },
		{
			...cf,
			async: buildResult.external.variables.some(isAsyncPredicate),
			hasDefault,
			hasCodec,
			hasRef
		}
	)
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

const impl: CaptureImpl = {
	sourceOnlyValidator,
	maybeCapture,
	captureMirror,
	captureCodecMirror,
	captureBridgeFree
}

export function installCaptureImpl() {
	setCaptureImpl(impl)
	// capture consumes the reconstruction table (`isCapturedBridgeFree`,
	// frozen replay), so wiring one without the other is never valid
	installReconstructImpl()
}

installCaptureImpl()

export { impl as captureImplementation }
