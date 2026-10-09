import { Compile, Build } from 'typebox/schema'
import type { TSchema } from 'typebox/type'

import { hasProperty } from '../utils'
import { buildFrozenCheck } from './frozen-check'
import { schemaHasDangerousProperties } from './clean-safe'
import type {
	CapturedMirror,
	CapturedValidator,
	CheckBuildResult
} from '../../compile/aot'
import { collectStringCodecNodes } from '../../compile/aot-reconstruct'
import {
	captureMirrorCodecs,
	captureMirrorUnions
} from '../../compile/aot-emit'
import type { ValidatorOptions } from '../../validator'
import { getExactMirror } from './exact-mirror'

// TypeBox >= 1.3.24 dropped `Validator.buildResult` (sinclairzx81/typebox#1680),
// which `captureMirrorUnions` reads off exact-mirror's compiled union branches
export function compileWithBuild(schema: TSchema) {
	const v: any = Compile(schema)
	v.buildResult ??= Build(schema)

	return v
}

function captureInnerCodec(
	inner: any,
	open: number,
	sanitize: ValidatorOptions['sanitize']
): NonNullable<CapturedValidator['innerCodecs']>[number] | undefined {
	if (schemaHasDangerousProperties(inner)) return
	// inner defaults aren't reconstructed under seal → refuse this slot so the
	// route degrades to TypeBox (which fills the default at runtime)
	if (hasProperty('default', inner)) return
	const createMirror = getExactMirror()
	if (!createMirror) return

	let cf: ReturnType<typeof buildFrozenCheck>
	try {
		cf = buildFrozenCheck(
			Build(inner) as unknown as CheckBuildResult,
			inner
		)
	} catch {}
	if (!cf) return

	let decode: CapturedMirror
	try {
		const emitted = createMirror(inner, {
			Compile: compileWithBuild,
			sanitize,
			decode: true,
			emit: true
		}) as { source?: string; externals?: any }

		if (typeof emitted?.source !== 'string') return
		const ext = emitted.externals

		if (ext?.hof) return
		if (ext?.codecs && !captureMirrorCodecs(inner, ext.codecs)) return

		let u: { identifier: string; code: string }[][] | undefined
		if (ext?.unions && ext.unions.length) {
			u = captureMirrorUnions(inner, ext.unions)
			if (!u) return
		}

		decode = {
			source: emitted.source,
			hasExternals: !!(ext?.codecs || u),
			u
		}
	} catch {
		return
	}

	return { open, ...cf, decode }
}

export function captureStringCodecEntries(
	schema: TSchema,
	sanitize: ValidatorOptions['sanitize']
): CapturedValidator['innerCodecs'] | undefined {
	const stringCodecs = collectStringCodecNodes(schema)
	if (!stringCodecs.length) return

	const entries: NonNullable<CapturedValidator['innerCodecs']> = []

	for (const { inner, open } of stringCodecs) {
		const entry = captureInnerCodec(inner, open, sanitize)
		if (!entry) break
		entries.push(entry)
	}

	return entries.length === stringCodecs.length ? entries : undefined
}
