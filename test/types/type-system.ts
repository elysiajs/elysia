/* eslint-disable @typescript-eslint/no-unused-vars */
import { t, Elysia, form, file } from '../../src'
import { expectTypeOf } from 'expect-type'

// ? ArrayString
{
	new Elysia().post(
		'/',
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf([] as string[])
		},
		{
			body: t.ArrayString(t.String())
		}
	)
}

// ? Form
{
	new Elysia()
		.get(
			'/',
			() =>
				form({
					name: 'Misono Mika',
					file: file('example/kyuukurarin.mp4')
				}),
			{
				response: t.Form({
					name: t.String(),
					file: t.File()
				})
			}
		)
		.get(
			'/',
			// @ts-expect-error
			() =>
				form({
					file: 'a'
				}),
			{
				response: t.Form({
					name: t.String(),
					file: t.File()
				})
			}
		)
}

// Files
{
	new Elysia().get(
		'/',
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<{
				images: File[]
			}>()
		},
		{
			body: t.Object({
				images: t.Files({
					maxSize: '4m',
					type: 'image'
				})
			})
		}
	)
}

// use StaticDecode to unwrap type parameter
{
	function addTwo(num: number) {
		return num + 2
	}

	new Elysia().get('', async ({ query: { foo } }) => addTwo(foo), {
		query: t.Object({
			foo: t
				.Transform(t.String())
				.Decode((x) => 12)
				.Encode((x) => x.toString())
		})
	})
}

// handle Elysia.Ref
{
	const Model = new Elysia().model({
		hello: t.Number()
	})

	new Elysia().use(Model).get(
		'',
		async ({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<number>()
		},
		{
			body: Model.Ref('hello')
		}
	)
}

// Transform Tuple<ElysiaFile> to Files[]
{
	new Elysia().get(
		'/test',
		() => {
			return form({
				files: [file('test.png'), file('test.png')],
				text: 'hello'
			})
		},
		{
			response: t.Form({
				files: t.Files(),
				text: t.String()
			})
		}
	)
}
