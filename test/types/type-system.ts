/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'bun:test'
import { t, Elysia, RouteSchema, Cookie, form, file } from '../../src'
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
