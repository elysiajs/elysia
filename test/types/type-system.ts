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

// ? Form as a REQUEST body decodes to the plain field object (not the
// ElysiaFormData wrapper used for responses) — the decode/encode split.
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

// `StaticCyclic` threads registered models as the resolution context. These pins
// lock that a `t.Ref('model')` still resolves once models are registered — the
// soundness boundary for passing `Defs` directly (vs the old `TCyclic` wrapper).

// a model that references ANOTHER model (cross-model ref), via string ref
{
	const Model = new Elysia().model({
		inner: t.Object({ v: t.String() }),
		outer: t.Object({ a: t.Number(), child: t.Ref('inner') })
	})

	Model.post('/', { body: 'outer' }, ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<{ a: number; child: { v: string } }>()
	})
}

// recursive / self-referencing model resolves (structurally) without blowing up
{
	const Model = new Elysia().model({
		category: t.Object({
			name: t.String(),
			parent: t.Optional(t.Ref('category'))
		})
	})

	Model.post('/', { body: 'category' }, ({ body }) => {
		expectTypeOf<typeof body extends { name: string } ? true : false>().toEqualTypeOf<true>()
		expectTypeOf<
			undefined extends (typeof body)['parent'] ? true : false
		>().toEqualTypeOf<true>()
	})
}

// `t.Module` — a self-contained cyclic namespace used as a route schema
{
	const Module = t.Module({
		User: t.Object({ name: t.String(), friend: t.Optional(t.Ref('User')) })
	})

	new Elysia().model({ z: t.Number() }).post('/', { body: Module.User }, ({ body }) => {
		expectTypeOf<typeof body extends { name: string } ? true : false>().toEqualTypeOf<true>()
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
