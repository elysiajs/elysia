/** Runs captured scalar coercion with the TypeBox bridge deliberately unwired. */
import { readFileSync } from 'node:fs'

import { Compiled, type CapturedValidator } from '../../../src/compile/aot'
import { buildFrozenRouteValidator } from '../../../src/compile/handler/frozen-validator'
import { hasTypes } from '../../../src/type/bridge'
import { materialise } from '../_manifest'

// Leaf coercion imports avoid the type barrel that wires the bridge.
import { Numeric } from '../../../src/type/elysia/numeric'
import { IntegerString } from '../../../src/type/elysia/integer-string'
import { BooleanString } from '../../../src/type/elysia/boolean-string'
import { DateType } from '../../../src/type/elysia/date'

const out = (tag: string, data: unknown) =>
	console.log(tag, JSON.stringify(data))

// The bridge must remain unwired for this process to isolate frozen reconstruction.
try {
	hasTypes([], { '~kind': 'Object' } as any)
	out('BRIDGE', 'wired')
	process.exit(2)
} catch {
	out('BRIDGE', 'unwired')
}

type LeafSpec = {
	t: 'numeric' | 'integer' | 'boolean' | 'date' | 'string'
	optional?: boolean
}

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
	// Mirror the non-enumerable marker used by t.Optional.
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

// Rebuild the same plain-object slot schema captured by the parent.
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
