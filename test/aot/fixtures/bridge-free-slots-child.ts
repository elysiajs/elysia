/**
 * Child process for `bridge-free-slots.test.ts`.
 *
 * Twin of `bridge-free-child.ts`, but for SLOT-LEVEL scalar coercion
 * (query/headers/params/cookie: `t.Numeric()`, `t.IntegerString()`,
 * `t.BooleanString()`, `t.Date()`, `t.Optional(...)` of those, + plain scalars).
 *
 * The bridge is NEVER wired here: it imports ONLY the reconstruct machinery and
 * the PURE coercion constructors from `src/type/elysia/*` (which do NOT pull the
 * type barrel's `setupTypebox` side effect), NOT the elysia type barrel. So it is
 * a faithful stand-in for a sealed build with `compat` stripped and the bridge
 * severed.
 *
 * Input (env `PAYLOAD`): `{ captured, spec, cases, method, path, slot }` produced
 * by the parent (where the bridge IS wired for capture). The child:
 *   1. asserts the bridge is unwired (proving the scenario),
 *   2. rebuilds the coercion schema from `spec` using the pure constructors,
 *   3. materialises the captured manifest into `Compiled.validators`,
 *   4. reconstructs the validator bridge-free and runs each case,
 * printing `RESULT <json>` for the parent to assert on.
 */
import { readFileSync } from 'node:fs'

import {
	Compiled,
	type CapturedValidator
} from '../../../src/compile/aot'
import { buildFrozenRouteValidator } from '../../../src/compile/handler/frozen-validator'
import { hasTypes } from '../../../src/type/bridge'
import { materialise } from '../_manifest'

// PURE coercion constructors — importing these does NOT wire the bridge
// (verified: they import `typebox/type` + local leaves, never the type barrel).
import { Numeric } from '../../../src/type/elysia/numeric'
import { IntegerString } from '../../../src/type/elysia/integer-string'
import { BooleanString } from '../../../src/type/elysia/boolean-string'
import { DateType } from '../../../src/type/elysia/date'

const out = (tag: string, data: unknown) =>
	console.log(tag, JSON.stringify(data))

// 1. the bridge MUST be unwired here — otherwise the test proves nothing.
try {
	hasTypes([], { '~kind': 'Object' } as any)
	out('BRIDGE', 'wired')
	process.exit(2)
} catch {
	out('BRIDGE', 'unwired')
}

type LeafSpec =
	| { t: 'numeric' | 'integer' | 'boolean' | 'date' | 'string'; optional?: boolean }

const payload = JSON.parse(readFileSync(process.env.PAYLOAD!, 'utf8')) as {
	captured: CapturedValidator[]
	spec: Record<string, LeafSpec>
	cases: unknown[]
	method: string
	path: string
	slot: 'query' | 'headers' | 'params' | 'cookie'
}

const optional = (schema: any, isOptional?: boolean) => {
	if (!isOptional) return schema
	// mirror `t.Optional`: attach a non-enumerable `~optional` marker (parity with
	// how the pure ctors preserve it through coercion).
	return Object.defineProperty(Object.create(schema), '~optional', {
		value: true,
		enumerable: false
	})
}

const buildLeaf = (leaf: LeafSpec): unknown => {
	switch (leaf.t) {
		case 'numeric':
			return optional(Numeric(), leaf.optional)
		case 'integer':
			return optional(IntegerString(), leaf.optional)
		case 'boolean':
			return optional(BooleanString(), leaf.optional)
		case 'date':
			return optional(DateType(), leaf.optional)
		case 'string':
			return optional(
				{ '~kind': 'String', type: 'string' },
				leaf.optional
			)
	}
}

// Rebuild the slot schema (a plain object whose leaves are the pure coercion
// constructors) — the SAME shape the parent captured against.
const properties: Record<string, unknown> = {}
const required: string[] = []
for (const key in payload.spec) {
	properties[key] = buildLeaf(payload.spec[key]!)
	if (!payload.spec[key]!.optional) required.push(key)
}

const schema = Object.defineProperty(
	{ type: 'object', properties, required },
	'~kind',
	{ value: 'Object', enumerable: false }
)

Compiled.validators = materialise(payload.captured)

const hook = { [payload.slot]: schema } as any
const root = { '~config': {}, '~ext': {} } as any

const validator = buildFrozenRouteValidator(
	hook,
	root,
	payload.method as any,
	payload.path
)

const slotValidator = validator && (validator as any)[payload.slot]

if (!slotValidator) {
	out('RESULT', { reconstructed: false })
	process.exit(0)
}

const results = payload.cases.map((value) => {
	try {
		return { ok: true, value: slotValidator.From(value, payload.slot) }
	} catch (error: any) {
		return { ok: false, status: error?.status ?? 500 }
	}
})

out('RESULT', { reconstructed: true, results })
