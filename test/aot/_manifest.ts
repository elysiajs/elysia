import {
	Compiled,
	createAotFingerprint,
	type CapturedValidator,
	type ProgramId,
	type ValidatorManifest,
	type CapturedHandler,
	type HandlerManifest
} from '../../src/compile/aot'
import { Source, installReconstructImpl } from '../../src/compile/aot-emit'

// Reconstruct in-process manifests through the same table as generated modules.
installReconstructImpl()

import { CheckContext } from 'typebox/schema'
import { buildCoercedFromPlan } from '../../src/type/coerce-plan'
import { Guard } from 'typebox/guard'
import { Format } from 'typebox/format'
import { Hashing } from 'typebox/system'

interface TestManifest {
	validators?: ValidatorManifest
	handlers?: HandlerManifest
	lazyGroups?: Array<() => ValidatorManifest>
	lazyGroupOf?: Record<string, Record<string, number>>
}

/**
 * Register a materialised manifest on the program lane, like a generated
 * module would. The next app build claims it through its own `~programId`.
 */
export const registerManifest = (manifest: TestManifest) =>
	Compiled.register({
		bf: 1,
		fingerprint: createAotFingerprint(),
		planRebuilder: buildCoercedFromPlan,
		...manifest
	})

/**
 * Register + claim under a fresh ProgramId without booting an app. The
 * returned holder threads the id as ValidatorOptions `app` or a frozen root.
 */
export const claimManifest = (
	manifest: TestManifest
): { ['~programId']: ProgramId } => {
	const id = {} as ProgramId
	registerManifest(manifest)
	Compiled.claim(id, createAotFingerprint())
	return { '~programId': id }
}

// `new Function` receives the module globals that generated imports normally bind.
const fn = (src: string) =>
	new Function('CheckContext', 'Guard', 'Format', 'Hashing', `return ${src}`)(
		CheckContext,
		Guard,
		Format,
		Hashing
	)

/** Materialise captured handlers into a frozen `{ a, f }` manifest. */
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

/** Materialise captured validators into the frozen manifest emitted by builds. */
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
			// One factory provides both check and clean operations.
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
				s: fn(
					Source.mirrorFactory(c.mirror.source, c.mirror.hasExternals)
				)
			}
			if (c.mirror.u) mir.u = branchTable(c.mirror.u)
			entry.m = mir
		}

		// Request-side decode mirror.
		if (c.decodeMirror) {
			const dm: any = {
				s: fn(Source.mirrorFactory(c.decodeMirror.source, true))
			}
			if (c.decodeMirror.u) dm.u = branchTable(c.decodeMirror.u)
			entry.dm = dm
		}

		// Response-side encode mirror.
		if (c.encodeMirror) {
			const em: any = {
				s: fn(Source.mirrorFactory(c.encodeMirror.source, true))
			}
			if (c.encodeMirror.u) em.u = branchTable(c.encodeMirror.u)
			entry.em = em
		}

		// Preallocated defaults use the same JSON round-trip as generated output.
		if (c.precomputeSafe) {
			entry.ps = 1
			if (c.precomputedDefault !== undefined)
				entry.pd = JSON.parse(JSON.stringify(c.precomputedDefault))
			if (c.precomputeNull) entry.pn = 1
			if (c.precomputedObjectDefault !== undefined)
				entry.pod = JSON.parse(
					JSON.stringify(c.precomputedObjectDefault)
				)
			if (c.defaultCloner) entry.dc = fn(c.defaultCloner)
			if (c.objectDefaultMerger) entry.pm = fn(c.objectDefaultMerger)
		}

		// Per-field custom error checks.
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

		// Inner ObjectString and ArrayString codec nodes.
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

		// Coercion plans rely on the rebuilder `registerManifest` registers.
		if (c.coercePlan) entry.cp = JSON.parse(JSON.stringify(c.coercePlan))

		const bySlot = ((m[c.method] ??= {})[c.path] ??= {})
		bySlot[c.slot] = entry
	}
	return m
}
