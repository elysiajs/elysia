import { Compile, Build } from 'typebox/schema'
import type { TSchema } from 'typebox/type'
import createMirror from 'exact-mirror'

import { ELYSIA_TYPES } from '../constants'
import { hasProperty } from '../utils'
import { buildFrozenCheck } from './frozen-check'
import {
	Capture,
	collectExternals,
	instantiateFrozenDecodeMirror,
	type CapturedMirror,
	type CapturedValidator,
	type CheckBuildResult,
	type FrozenValidator
} from '../../compile/aot'
import type { ValidatorOptions } from '../../validator'

// capture ObjectString/ArrayString inner codecs
// The traversal order is the capture↔reconstruct contract: `ic[i]`
// aligns 1:1 with `nodes[i]`
// (reconstruct iterates in REVERSE for bottom-up overwrite)
//
// so keep self → properties → items → anyOf.
interface StringCodecNode {
	inner: any
	codec: any
	open: number
}

function collectStringCodecNodes(
	schema: any,
	out: StringCodecNode[] = []
): StringCodecNode[] {
	if (!schema || typeof schema !== 'object') return out

	const ely = schema['~elyTyp']
	if (ely === ELYSIA_TYPES.ObjectString || ely === ELYSIA_TYPES.ArrayString) {
		const inner = schema.anyOf?.[0]
		const codec = schema.anyOf?.[1]
		if (inner && codec?.['~codec'] && codec['~refine'])
			out.push({
				inner,
				codec,
				open: ely === ELYSIA_TYPES.ObjectString ? 123 : 91
			})
	}

	if (schema.properties)
		for (const k in schema.properties)
			collectStringCodecNodes(schema.properties[k], out)

	const items = schema.items
	if (Array.isArray(items)) {
		for (const it of items) collectStringCodecNodes(it, out)
	} else if (items) collectStringCodecNodes(items, out)

	if (Array.isArray(schema.anyOf))
		for (const b of schema.anyOf) collectStringCodecNodes(b, out)

	return out
}

// Iterate in reverse so nested codecs reconstruct bottom-up
export function reconstructInnerCodecs(
	ic: NonNullable<FrozenValidator['ic']>,
	schema: any
): void {
	const nodes = collectStringCodecNodes(schema)

	for (let i = nodes.length - 1; i >= 0; i--) {
		const entry = ic[i]
		const node = nodes[i]
		if (!entry || !node) continue

		const innerSchema = node.inner
		const innerCheck = entry.c(entry.e ? collectExternals(innerSchema) : [])
		const innerMirror = entry.d.x
			? instantiateFrozenDecodeMirror(entry.d, innerSchema)
			: (entry.d.s as (value: unknown) => unknown)

		const open = entry.o
		node.codec['~refine'][0].check = (v: string) => {
			if (v.charCodeAt(0) !== open) return false

			try {
				return innerCheck(JSON.parse(v))
			} catch {
				return false
			}
		}

		node.codec['~codec'].decode = (v: string) => innerMirror(JSON.parse(v))
	}
}

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
