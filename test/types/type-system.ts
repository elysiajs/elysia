/* eslint-disable @typescript-eslint/no-unused-vars */
import { t, Elysia, form, file } from '../../src'
import { expectTypeOf } from 'expect-type'

// ? ArrayString
{
	new Elysia().post(
		'/',
		{
			body: t.ArrayString(t.String())
		},
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf([] as string[])
		}
	)
}

// ? Form
{
	new Elysia()
		.get(
			'/',
			{
				response: t.Form({
					name: t.String(),
					file: t.File()
				})
			},
			() =>
				form({
					name: 'Misono Mika',
					file: file('example/kyuukurarin.mp4')
				})
		)
		.get(
			'/',
			{
				response: t.Form({
					name: t.String(),
					file: t.File()
				})
			},
			// @ts-expect-error
			() =>
				form({
					file: 'a'
				})
		)
}

// Request form bodies decode to plain field objects.
{
	new Elysia().post(
		'/',
		{
			body: t.Form({
				name: t.String(),
				file: t.File(),
				files: t.Files()
			})
		},
		({ body }) => {
			expectTypeOf<typeof body.name>().toEqualTypeOf<string>()
			expectTypeOf<typeof body.file>().toEqualTypeOf<File>()
			expectTypeOf<typeof body.files>().toEqualTypeOf<File[]>()
		}
	)
}

// Files
{
	new Elysia().get(
		'/',
		{
			body: t.Object({
				images: t.Files({
					maxSize: '4m',
					type: 'image'
				})
			})
		},
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<{
				images: File[]
			}>()
		}
	)
}

// use StaticDecode to unwrap type parameter
{
	function addTwo(num: number) {
		return num + 2
	}

	new Elysia().get(
		'',
		{
			query: t.Object({
				foo: t
					.Codec(t.String())
					.Decode((x) => 12)
					.Encode((x) => x.toString())
			})
		},
		async ({ query: { foo } }) => addTwo(foo)
	)
}

// handle Elysia.Ref
{
	const Model = new Elysia().model({
		hello: t.Number()
	})

	new Elysia().use(Model).get(
		'',
		{
			body: Model.Ref('hello')
		},
		async ({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<number>()
		}
	)
}

// Registered model references resolve in route schemas.

// Models can reference other registered models.
{
	const Model = new Elysia().model({
		inner: t.Object({ v: t.String() }),
		outer: t.Object({ a: t.Number(), child: t.Ref('inner') })
	})

	Model.post('/', { body: 'outer' }, ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<{
			a: number
			child: { v: string }
		}>()
	})
}

// Recursive models resolve structurally.
{
	const Model = new Elysia().model({
		category: t.Object({
			name: t.String(),
			parent: t.Optional(t.Ref('category'))
		})
	})

	Model.post('/', { body: 'category' }, ({ body }) => {
		expectTypeOf<
			typeof body extends { name: string } ? true : false
		>().toEqualTypeOf<true>()
		expectTypeOf<
			undefined extends (typeof body)['parent'] ? true : false
		>().toEqualTypeOf<true>()
	})
}

// `t.Module` supports self-references in route schemas.
{
	const Module = t.Module({
		User: t.Object({ name: t.String(), friend: t.Optional(t.Ref('User')) })
	})

	new Elysia()
		.model({ z: t.Number() })
		.post('/', { body: Module.User }, ({ body }) => {
			expectTypeOf<
				typeof body extends { name: string } ? true : false
			>().toEqualTypeOf<true>()
			expectTypeOf<
				undefined extends (typeof body)['friend'] ? true : false
			>().toEqualTypeOf<true>()
		})
}

// Transform Tuple<ElysiaFile> to Files[]
{
	new Elysia().get(
		'/test',
		{
			response: t.Form({
				files: t.Files(),
				text: t.String()
			})
		},
		() => {
			return form({
				files: [file('test.png'), file('test.png')],
				text: 'hello'
			})
		}
	)
}

// ArrayBuffer, Uint8Array and NumericEnum are hand-built schemas; their
// handler types must come from the schema, not an `any` return
{
	type IsAny<T> = 0 extends 1 & T ? true : false

	enum E {
		A = 1,
		B = 2
	}

	expectTypeOf<
		IsAny<ReturnType<typeof t.ArrayBuffer>>
	>().toEqualTypeOf<false>()
	expectTypeOf<
		IsAny<ReturnType<typeof t.Uint8Array>>
	>().toEqualTypeOf<false>()
	expectTypeOf<
		IsAny<ReturnType<typeof t.NumericEnum<typeof E>>>
	>().toEqualTypeOf<false>()

	const app = new Elysia()
		.post('/array-buffer', { body: t.ArrayBuffer() }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<ArrayBuffer>()
		})
		.post(
			'/array-buffer-limit',
			{ body: t.ArrayBuffer({ maxByteLength: 4 }) },
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<ArrayBuffer>()
			}
		)
		.post('/uint8-array', { body: t.Uint8Array() }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<Uint8Array>()
		})
		.get(
			'/enum',
			{
				query: t.Object({
					e: t.NumericEnum(E),
					c: t.NumericEnum({ X: 1, Y: 2 } as const)
				})
			},
			({ query }) => {
				expectTypeOf(query.e).toEqualTypeOf<E>()
				expectTypeOf(query.c).toEqualTypeOf<1 | 2>()
			}
		)

	// a client sends a member as a number or its numeric string; the handler
	// sees `E`
	type Routes = (typeof app)['~Routes']
	expectTypeOf<Routes['enum']['get']['query']['e']>().toEqualTypeOf<
		E | `${E}`
	>()
	expectTypeOf<Routes['enum']['get']['query']['c']>().toEqualTypeOf<
		1 | 2 | '1' | '2'
	>()
}
