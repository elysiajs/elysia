import {
	checkFactorySource,
	checkCode,
	mirrorFactorySource,
	bothFactorySource,
	handlerFactorySource,
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
			f: fn(handlerFactorySource(h.alias, h.code)) as any
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
				branch.map((b) => fn(checkFactorySource(b.identifier, b.code)))
			)

		if (c.checkValue && c.mirror) {
			// merged: one factory → { check, clean }; `u` rides at entry level
			entry.cm = fn(
				bothFactorySource(
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
				checkFactorySource(
					c.identifier!,
					checkCode(c.checkDefs!, c.checkValue)
				)
			)
			setFlags()
		} else if (c.mirror) {
			const mir: any = {
				s: fn(mirrorFactorySource(c.mirror.source, c.mirror.hasExternals))
			}
			if (c.mirror.u) mir.u = branchTable(c.mirror.u)
			entry.m = mir
		}

		const bySlot = ((m[c.method] ??= {})[c.path] ??= {})
		bySlot[c.slot] = entry
	}
	return m
}
