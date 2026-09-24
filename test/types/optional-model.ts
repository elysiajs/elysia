import { Elysia, t, type UnwrapRoute, type UnwrapSchema } from '../../src'
import { expectTypeOf } from 'expect-type'

const OptionalName = t.Optional(t.Object({ name: t.String() }))

type OptionalParts<Schema> = { headers: Schema; params: Schema; cookie: Schema }
expectTypeOf<
	Pick<
		UnwrapRoute<
			OptionalParts<'OptionalName'>,
			{ OptionalName: typeof OptionalName }
		>,
		'headers' | 'params' | 'cookie'
	>
>().toEqualTypeOf<
	Pick<
		UnwrapRoute<OptionalParts<typeof OptionalName>>,
		'headers' | 'params' | 'cookie'
	>
>()

// Reusing an optional schema by name must preserve absent-input checks.
new Elysia()
	.model({ OptionalName })
	.post(
		'/',
		{ body: 'OptionalName', query: 'OptionalName' },
		({ body, query }) => {
			expectTypeOf(body).toEqualTypeOf<
				{ name?: string } | null | undefined
			>()
			expectTypeOf(query).toEqualTypeOf<{ name?: string }>()
			// @ts-expect-error an absent optional body has no required name
			body.name.toUpperCase()
			// @ts-expect-error an absent optional query has no required name
			query.name.toUpperCase()
			return body?.name ?? query.name ?? 'absent'
		}
	)

new Elysia().post(
	'/',
	{ body: OptionalName, query: OptionalName },
	({ body, query }) => {
		expectTypeOf(body).toEqualTypeOf<{ name?: string } | null | undefined>()
		expectTypeOf(query).toEqualTypeOf<{ name?: string }>()
		return body?.name ?? query.name ?? 'absent'
	}
)

const models = {
	OptionalName,
	Alias: t.Ref('OptionalName'),
	Alias2: t.Ref('Alias'),
	RequiredName: t.Object({ name: t.String() })
}

new Elysia()
	.model(models)
	.post(
		'/ref',
		{ body: t.Ref('OptionalName'), query: t.Ref('OptionalName') },
		({ body, query }) => {
			expectTypeOf(body).toEqualTypeOf<
				{ name?: string } | null | undefined
			>()
			expectTypeOf(query).toEqualTypeOf<{ name?: string }>()
			// @ts-expect-error Ref resolution preserves absent optional body fields
			body.name.toUpperCase()
			// @ts-expect-error Ref resolution preserves absent optional query fields
			query.name.toUpperCase()
			return body?.name ?? query.name ?? 'absent'
		}
	)
	.post('/alias', { body: 'Alias2', query: 'Alias' }, ({ body, query }) => {
		expectTypeOf(body).toEqualTypeOf<{ name?: string } | null | undefined>()
		expectTypeOf(query).toEqualTypeOf<{ name?: string }>()
		// @ts-expect-error alias chains preserve absent optional body fields
		body.name.toUpperCase()
		// @ts-expect-error alias chains preserve absent optional query fields
		query.name.toUpperCase()
		return body?.name ?? query.name ?? 'absent'
	})
	.post('/required', { body: t.Ref('RequiredName') }, ({ body }) => {
		expectTypeOf(body).toEqualTypeOf<{ name: string }>()
		return body.name.toUpperCase()
	})
	.get('/response', { response: t.Ref('OptionalName') }, () => ({
		name: 'present'
	}))

const responseRef = t.Ref('OptionalName')
type RefResponse = UnwrapRoute<
	{ response: typeof responseRef },
	typeof models
>['response']
expectTypeOf<RefResponse>().toEqualTypeOf<{ 200: { name: string } }>()
// @ts-expect-error input optionality must not relax the established response type
const invalidResponse: RefResponse = { 200: {} }

declare const target: 'OptionalName' | 'RequiredName'
new Elysia().model(models).get('/', { query: t.Ref(target) }, ({ query }) => {
	expectTypeOf(query).toEqualTypeOf<{ name?: string }>()
	// @ts-expect-error the selected Ref target may permit an absent field
	query.name.toUpperCase()
	return query.name ?? 'absent'
})

const missing = t.Ref('Missing')
// A missing alias must not widen to any while checking optionality.
expectTypeOf<UnwrapSchema<typeof missing, typeof models>>().not.toBeAny()

const OptionalString = t.Optional(t.String())
const primitives = {
	OptionalString,
	StringAlias: t.Ref('OptionalString')
}

// A null-only guard still permits the undefined value from an absent body.
new Elysia()
	.model(primitives)
	.post('/primitive-inline', { body: OptionalString }, ({ body }) => {
		expectTypeOf(body).toEqualTypeOf<string | null | undefined>()
		if (body !== null) {
			// @ts-expect-error absent primitive bodies are undefined
			body.toUpperCase()
		}
		return body?.toUpperCase() ?? 'absent'
	})
	.post('/primitive-name', { body: 'OptionalString' }, ({ body }) => {
		expectTypeOf(body).toEqualTypeOf<string | null | undefined>()
		if (body !== null) {
			// @ts-expect-error a named optional primitive body can be undefined
			body.toUpperCase()
		}
		return typeof body === 'string' ? body.toUpperCase() : 'absent'
	})
	.post('/primitive-ref', { body: t.Ref('OptionalString') }, ({ body }) => {
		expectTypeOf(body).toEqualTypeOf<string | null | undefined>()
		if (body !== null) {
			// @ts-expect-error an optional primitive Ref body can be undefined
			body.toUpperCase()
		}
		return body != null ? body.toUpperCase() : 'absent'
	})
	.post('/primitive-alias', { body: 'StringAlias' }, ({ body }) => {
		expectTypeOf(body).toEqualTypeOf<string | null | undefined>()
		return body?.toUpperCase() ?? 'absent'
	})

new Elysia().post('/optional-object', { body: OptionalName }, ({ body }) => {
	if (body !== null) {
		// @ts-expect-error optional body types conservatively include undefined
		const value: object = body
	}
	if (body != null) {
		const value: object = body
		return value
	}
	return 'absent'
})
