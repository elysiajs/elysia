import { Type } from 'typebox'
import { Default } from 'typebox/value'
import { profile } from './utils'

// Compares the current per-call `Default(schema, value)` walk against a
// precompute-+-structuredClone strategy. Goal: measure whether stashing a
// frozen "all-defaults" snapshot at validator-construction time and cloning
// it per request beats TypeBox's recursive Default walk.

const ITERS = 1_000_000

// ---- Schema 1: flat object, primitive defaults at leaves (best case) ----
const flatSchema = Type.Object({
	limit: Type.Number({ default: 10 }),
	offset: Type.Number({ default: 0 }),
	sort: Type.String({ default: 'asc' }),
	filter: Type.String({ default: 'all' })
})

// ---- Schema 2: nested object ----
const nestedSchema = Type.Object({
	pagination: Type.Object({
		limit: Type.Number({ default: 10 }),
		offset: Type.Number({ default: 0 })
	}),
	display: Type.Object({
		columns: Type.Array(Type.String(), { default: ['id', 'name'] }),
		hidden: Type.Boolean({ default: false })
	})
})

// ---- Schema 3: defaults but input always has all values ----
const fullInputSchema = flatSchema

function structuredCloneOrSpread<T>(v: T): T {
	// Bun and modern Node have global structuredClone.
	return structuredClone(v) as T
}

// Naive merge: shallow spread for top-level, recurse on object values that
// also exist in the precomputed default. Good enough for the benchmark; a
// real impl would be more careful about arrays / nullables / etc.
function deepMerge<T extends Record<string, unknown>>(
	defaults: T,
	value: Partial<T> | undefined | null
): T {
	if (value === undefined || value === null) return structuredClone(defaults)
	const out = structuredClone(defaults)
	for (const k in value) {
		const v = value[k]
		if (v === undefined) continue
		if (
			v &&
			typeof v === 'object' &&
			!Array.isArray(v) &&
			out[k] &&
			typeof out[k] === 'object' &&
			!Array.isArray(out[k])
		) {
			;(out as any)[k] = deepMerge(out[k] as any, v as any)
		} else {
			;(out as any)[k] = v
		}
	}
	return out
}

function bench(label: string, schema: any, input: () => unknown) {
	console.log('\n----', label, '----')

	{
		const stop = profile(`Default() x${ITERS}`)
		for (let i = 0; i < ITERS; i++) {
			const v = input()
			Default(schema, v)
		}
		stop()
	}

	{
		// Precompute once. `Default(schema, {})` walks the schema and fills
		// every default — gives us the "all defaults" snapshot we want to
		// cache. (Default with `undefined` would return undefined because
		// the top-level Object schema has no `default` of its own.)
		const precomputed = Default(schema, {})

		const stop = profile(`precompute+structuredClone x${ITERS}`)
		for (let i = 0; i < ITERS; i++) {
			const v = input()
			// Match TypeBox's `Default(schema, undefined)` behaviour: when
			// the top-level schema has no `default`, `Default()` returns
			// undefined unchanged. No defaults to fill in.
			if (v === undefined || v === null) continue
			deepMerge(precomputed as any, v as any)
		}
		stop()
	}
}

// ---- Run ----

console.log('=== Case A: input is undefined (no value provided) ===')
bench('flat schema, undefined input', flatSchema, () => undefined)
bench('nested schema, undefined input', nestedSchema, () => undefined)

console.log('\n=== Case B: input is empty object ===')
bench('flat schema, {} input', flatSchema, () => ({}))
bench('nested schema, {} input', nestedSchema, () => ({}))

console.log('\n=== Case C: input has all values (no defaults to fill) ===')
bench('flat schema, full input', fullInputSchema, () => ({
	limit: 25,
	offset: 5,
	sort: 'desc',
	filter: 'recent'
}))

console.log('\n=== Case D: input has some values (partial defaults) ===')
bench('flat schema, partial input', flatSchema, () => ({ limit: 25 }))
bench('nested schema, partial input', nestedSchema, () => ({
	pagination: { limit: 25 }
}))
