process.env.NODE_ENV = 'production'

export {}

const { t } = await import('../../src')
const { detachValidatorCompiler } = await import('../../src/validator')
const { RouteValidator } = await import('../../src/validator/route')

let errorAnnotation: object | undefined = { message: 'detached' }
const errorAnnotationRef = new WeakRef(errorAnnotation)
let schema: any = t.Object({
	when: t.Date(),
	count: t.Number({ default: 1 }),
	name: t.Refine(t.String({ error: 'name' }), (value) => value.length > 0),
	annotation: t.Optional(t.Number({ error: errorAnnotation }))
})
const schemaRef = new WeakRef(schema)
const root = {}
const validator: any = new RouteValidator(
	{ body: schema },
	{
		app: root,
		sanitize: ((value: unknown) => (value === '<' ? '&lt;' : value)) as any
	}
).body

schema = undefined
errorAnnotation = undefined
detachValidatorCompiler(root)

const value = validator.FromSync(
	{ when: '2020-01-01T00:00:00.000Z', name: 'ok', annotation: 1 },
	'body'
)
let custom: unknown
try {
	validator.FromSync(
		{ when: '2020-01-01T00:00:00.000Z', name: '', annotation: 1 },
		'body'
	)
} catch (error: any) {
	custom = error.customError
}

for (let index = 0; index < 12; index++) {
	new Uint8Array(1024 * 1024)[0] = index
	Bun.gc(true)
	await Bun.sleep(0)
}

console.log(
	JSON.stringify({
		reachable: schemaRef.deref() !== undefined,
		annotationReachable: errorAnnotationRef.deref() !== undefined,
		valid: {
			date: value.when instanceof Date,
			count: value.count,
			name: value.name,
			annotation: value.annotation
		},
		custom
	})
)
