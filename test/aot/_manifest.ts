import {
	Source,
	type CapturedValidator,
	type ValidatorManifest,
	type CapturedHandler,
	type HandlerManifest
} from '../../src/compile/aot'

import { CheckContext } from 'typebox/schema'
import { Guard } from 'typebox/guard'
import { Format } from 'typebox/format'
import { Hashing } from 'typebox/system'

// The check factories close over module-global CheckContext/Guard/Format/Hashing
// (the real build supplies them via import). In-process, `new Function` has no
// such scope, so we pass them as args — same instances, just a different binding.
const fn = (src: string) =>
	new Function(
		'CheckContext',
		'Guard',
		'Format',
		'Hashing',
		`return ${src}`
	)(CheckContext, Guard, Format, Hashing)

/** Materialise captured handlers into a frozen `{ a, f }` manifest (in-process). */
export const materialiseHandlers = (
	captured: CapturedHandler[]
): HandlerManifest => {
	const m: HandlerManifest = {}
	for (const h of captured) {
		;(m[h.method] ??= {})[h.path] = {
			a: h.alias ? h.alias.split(',') : [],
			f: fn(Source.handlerFactory(h.alias, h.code)) as any
		}
	}
	return m
}

/**
 * Materialise captured validators into a frozen manifest of REAL functions —
 * exactly what the build plugin emits, but in-process for tests. Handles the
 * check (`c`) and exact-mirror (`m`, incl. phase-3.5 union branches) channels.
 */
export const materialise = (
	captured: CapturedValidator[]
): ValidatorManifest => {
	const m: ValidatorManifest = {}
	for (const c of captured) {
		const entry: any = {}

		const setFlags = () => {
			if (c.external) entry.e = 1
			if (c.async) entry.a = 1
			if (c.hasDefault) entry.d = 1
			if (c.hasCodec) entry.k = 1
			if (c.hasRef) entry.r = 1
		}
		const branchTable = (u: NonNullable<typeof c.mirror>['u'] & {}) =>
			u.map((branch) =>
				branch.map((b) => fn(Source.checkFactory(b.identifier, b.code)))
			)

		if (c.checkValue && c.mirror) {
			// merged: one factory → { check, clean }; `u` rides at entry level
			entry.cm = fn(
				Source.bothFactory(
					c.identifier!,
					c.checkDefs!,
					c.checkValue,
					c.mirror.source,
					c.mirror.hasExternals
				)
			)
			setFlags()
			if (c.mirror.u) entry.u = branchTable(c.mirror.u)
		} else if (c.checkValue) {
			entry.c = fn(
				Source.checkFactory(
					c.identifier!,
					Source.checkCode(c.checkDefs!, c.checkValue)
				)
			)
			setFlags()
		} else if (c.mirror) {
			const mir: any = {
				s: fn(Source.mirrorFactory(c.mirror.source, c.mirror.hasExternals))
			}
			if (c.mirror.u) mir.u = branchTable(c.mirror.u)
			entry.m = mir
		}

		// request-side decode mirror (always factory: codecs ride in `d`)
		if (c.decodeMirror) {
			const dm: any = {
				s: fn(Source.mirrorFactory(c.decodeMirror.source, true))
			}
			if (c.decodeMirror.u) dm.u = branchTable(c.decodeMirror.u)
			entry.dm = dm
		}

		// response-side encode mirror (symmetric to dm)
		if (c.encodeMirror) {
			const em: any = {
				s: fn(Source.mirrorFactory(c.encodeMirror.source, true))
			}
			if (c.encodeMirror.u) em.u = branchTable(c.encodeMirror.u)
			entry.em = em
		}

		// preallocated defaults — round-trip through JSON to match the real
		// emit (the build serializes `pd`/`pod` via JSON.stringify).
		if (c.precomputeSafe) {
			entry.ps = 1
			if (c.precomputedDefault !== undefined)
				entry.pd = JSON.parse(JSON.stringify(c.precomputedDefault))
			if (c.precomputedObjectDefault !== undefined)
				entry.pod = JSON.parse(JSON.stringify(c.precomputedObjectDefault))
		}

		// per-field custom-error checks
		if (c.customErrors?.length)
			entry.ce = c.customErrors.map((e) => ({
				p: e.path,
				c: fn(
					Source.checkFactory(
						e.identifier,
						Source.checkCode(e.checkDefs, e.checkValue)
					)
				),
				...(e.external ? { e: 1 } : {})
			}))

		// inner codecs (t.ObjectString / t.ArrayString)
		if (c.innerCodecs?.length)
			entry.ic = c.innerCodecs.map((e) => {
				const d: any = {
					s: fn(
						Source.mirrorFactory(
							e.decode.source,
							e.decode.hasExternals
						)
					)
				}
				if (e.decode.u) d.u = branchTable(e.decode.u)
				if (e.decode.hasExternals) d.x = 1
				return {
					o: e.open,
					c: fn(
						Source.checkFactory(
							e.identifier,
							Source.checkCode(e.checkDefs, e.checkValue)
						)
					),
					...(e.external ? { e: 1 } : {}),
					d
				}
			})

		// coercion plan — pure JSON, round-trip to match the real emit
		if (c.coercePlan) entry.cp = JSON.parse(JSON.stringify(c.coercePlan))

		const bySlot = ((m[c.method] ??= {})[c.path] ??= {})
		bySlot[c.slot] = entry
	}
	return m
}
