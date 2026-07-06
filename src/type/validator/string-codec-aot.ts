import { Compile, Build } from 'typebox/schema'
import type { TSchema } from 'typebox/type'
import createMirror from 'exact-mirror'

import { hasProperty } from '../utils'
import { buildFrozenCheck } from './frozen-check'
export { reconstructInnerCodecs } from '../../compile/aot'
import {
	Capture,
	collectStringCodecNodes,
	type CapturedMirror,
	type CapturedValidator,
	type CheckBuildResult
} from '../../compile/aot'
import type { ValidatorOptions } from '../../validator'

// Build time: freeze one ObjectString/ArrayString inner schema into a check
function captureInnerCodec(
	inner: any,
	open: number,
	sanitize: ValidatorOptions['sanitize']
): NonNullable<CapturedValidator['innerCodecs']>[number] | undefined {
	let cf: ReturnType<typeof buildFrozenCheck>
	try {
		cf = buildFrozenCheck(
			Build(inner) as unknown as CheckBuildResult,
			inner
		)
		if (!cf) return
	} catch {
		return
	}

	let decode: CapturedMirror
	try {
		const emitted = createMirror(inner, {
			Compile,
			sanitize,
			decode: true,
			emit: true
		}) as { source?: string; externals?: any }

		if (typeof emitted?.source !== 'string') return
		const ext = emitted.externals

		if (ext?.hof) return
		if (ext?.codecs && !Capture.mirrorCodecs(inner, ext.codecs)) return

		let u: { identifier: string; code: string }[][] | undefined
		if (ext?.unions && ext.unions.length) {
			u = Capture.mirrorUnions(inner, ext.unions)
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

	// inner defaults aren't reconstructed under seal → refuse this slot so the
	// route degrades to TypeBox (which fills the default at runtime)
	if (hasProperty('default', inner)) return

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
