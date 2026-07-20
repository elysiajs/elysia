process.env.NODE_ENV = 'production'

export {}

const { t } = await import('../../src')
const { createCleanPlan } = await import('../../src/type/validator/clean-plan')
const { createDefaultPlan } =
	await import('../../src/type/validator/default-plan')
const { createDecodePlan, createEncodePlan } =
	await import('../../src/type/validator/codec-plan')
const { createConvertPlan } =
	await import('../../src/type/validator/convert-plan')
const { createCompactErrorLocator } =
	await import('../../src/validator/compact-errors')

const retained: Array<(value: any) => any> = []
const watched: Array<[string, WeakRef<object>]> = []
const watch = (name: string, value: object) =>
	watched.push([name, new WeakRef(value)])

function retainCleanNested() {
	let child: any = t.Object({ value: t.String() })
	let schema: any = t.Object({ nested: child })
	watch('clean:nested:root', schema)
	watch('clean:nested:child', child)
	retained.push(createCleanPlan(schema))
	child = schema = undefined
}

function retainCleanAdditional() {
	let child: any = t.Object({ value: t.String() })
	let schema: any = t.Object({}, { additionalProperties: child })
	watch('clean:additional:root', schema)
	watch('clean:additional:child', child)
	retained.push(createCleanPlan(schema))
	child = schema = undefined
}

function retainCleanUnion() {
	let child: any = t.Object({ kind: t.Literal('a'), value: t.String() })
	let other: any = t.Object({ kind: t.Literal('b'), value: t.Number() })
	let schema: any = t.Union([child, other])
	watch('clean:union:root', schema)
	watch('clean:union:child', child)
	watch('clean:union:other', other)
	retained.push(createCleanPlan(schema), createConvertPlan(schema))
	child = other = schema = undefined
}

function retainCleanCyclic() {
	let schema: any = t.Cyclic(
		{
			Node: t.Object({
				value: t.String(),
				child: t.Union([t.Ref('Node'), t.Null()])
			})
		},
		'Node'
	)
	let child: any = schema.$defs.Node
	watch('clean:cyclic:root', schema)
	watch('clean:cyclic:child', child)
	retained.push(createCleanPlan(schema))
	child = schema = undefined
}

function retainDefault() {
	let child: any = t.Object({ value: t.String({ default: 'safe' }) })
	let schema: any = t.Object({ nested: child })
	watch('default:root', schema)
	watch('default:child', child)
	retained.push(createDefaultPlan(schema))
	child = schema = undefined
}

function retainCodec() {
	let child: any = t
		.Codec(t.String({ pattern: '^retention-probe$' }))
		.Decode((value) => value.length)
		.Encode((value) => String(value))
	let schema: any = t.Object({ value: child })
	watch('codec:root', schema)
	watch('codec:child', child)
	retained.push(
		createDecodePlan(schema),
		createEncodePlan(schema),
		createConvertPlan(schema)
	)
	child = schema = undefined
}

function retainLocator() {
	let child: any = t.Object({ value: t.Number({ minimum: 1 }) })
	let schema: any = t.Object({ nested: child })
	watch('locator:root', schema)
	watch('locator:child', child)
	retained.push(createCompactErrorLocator(schema))
	child = schema = undefined
}

retainCleanNested()
retainCleanAdditional()
retainCleanUnion()
retainCleanCyclic()
retainDefault()
retainCodec()
retainLocator()

// Exercise every retained operation so this is not merely a construction test.
retained.forEach((operation, index) => {
	try {
		operation(index % 2 ? { nested: {}, value: 'retention-probe' } : {})
	} catch {}
})

for (let index = 0; index < 24; index++) {
	new Uint8Array(1024 * 1024)[0] = index
	Bun.gc(true)
	await Bun.sleep(0)
}

console.log(
	JSON.stringify({
		alive: watched
			.filter(([, reference]) => reference.deref() !== undefined)
			.map(([name]) => name)
	})
)
