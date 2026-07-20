process.env.NODE_ENV = 'production'

export {}

const { t } = await import('../../src')
const { detachValidatorCompiler } = await import('../../src/validator')
const { RouteValidator } = await import('../../src/validator/route')

let schema: any = t.Object({
	when: t.Date(),
	count: t.Number({ default: 1 }),
	name: t.Refine(t.String({ error: 'name' }), (value) => value.length > 0)
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
detachValidatorCompiler(root)

const value = validator.FromSync(
	{ when: '2020-01-01T00:00:00.000Z', name: 'ok' },
	'body'
)
let custom: unknown
try {
	validator.FromSync({ when: '2020-01-01T00:00:00.000Z', name: '' }, 'body')
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
		valid: {
			date: value.when instanceof Date,
			count: value.count,
			name: value.name
		},
		custom
	})
)
