import {
	checkFactorySource,
	mirrorFactorySource,
	handlerFactorySource,
	type CapturedValidator,
	type ValidatorManifest,
	type CapturedHandler,
	type HandlerManifest
} from '../../src/compile/aot'

const fn = (src: string) => new Function(`return ${src}`)()

/** Materialise captured handlers into a frozen `{ a, f }` manifest (in-process). */
export const materialiseHandlers = (
	captured: CapturedHandler[]
): HandlerManifest => {
	const m: HandlerManifest = {}
	for (const h of captured) {
		;(m[h.method] ??= {})[h.path] = {
			a: h.alias,
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
		const entry: {
			c?: any
			m?: any
			e?: 1
			a?: 1
			d?: 1
			k?: 1
			r?: 1
		} = {}
		if (c.code) {
			entry.c = fn(checkFactorySource(c.identifier!, c.code))
			if (c.external) entry.e = 1
			if (c.async) entry.a = 1
			if (c.hasDefault) entry.d = 1
			if (c.hasCodec) entry.k = 1
			if (c.hasRef) entry.r = 1
		}
		if (c.mirror) {
			const mir: any = {
				s: fn(mirrorFactorySource(c.mirror.source, c.mirror.hasExternals))
			}
			if (c.mirror.u)
				mir.u = c.mirror.u.map((branch) =>
					branch.map((b) => fn(checkFactorySource(b.identifier, b.code)))
				)
			entry.m = mir
		}
		const bySlot = ((m[c.method] ??= {})[c.path] ??= {})
		bySlot[c.slot] = entry
	}
	return m
}
