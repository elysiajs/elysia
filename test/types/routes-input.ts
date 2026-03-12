/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, InferElysiaRoutesInput, UnwrapBodySchemaInput, t } from '../../src'
import { expectTypeOf } from 'expect-type'
import z from 'zod'

{
	const app = new Elysia().post(
		'/typed',
		() => ({ value: 1 }),
		{
			body: z.string().transform((value) => value.length),
			query: z.object({
				text: z.string(),
				flag: z.boolean(),
				mixed: z.number().or(z.string())
			}).transform((value) => ({
				...value,
				count: value.text.length,
			})),
			headers: z.object({
				count: z.coerce.number()
			}),
			params: z.object({
				id: z.number().or(z.string().transform((value) => parseInt(value)))
			}),
			response: z.object({
				value: z.number()
			})
		}
	)

	expectTypeOf<(typeof app)['~Routes']['typed']['post']['body']>().toEqualTypeOf<number>()
	expectTypeOf<(typeof app)['~Routes']['typed']['post']['query']>().toEqualTypeOf<{
		text: string
		count: number
		flag: boolean
		mixed: number | string
	}>()
	expectTypeOf<(typeof app)['~Routes']['typed']['post']['headers']>().toEqualTypeOf<{
		count: number
	}>()
	expectTypeOf<(typeof app)['~Routes']['typed']['post']['params']>().toEqualTypeOf<{
		id: number
	}>()
	expectTypeOf<(typeof app)['~Routes']['typed']['post']['response'][200]>().toEqualTypeOf<{
		value: number
	}>()

	expectTypeOf<(typeof app)['~RoutesInput']['typed']['post']['body']>().toEqualTypeOf<string>()
	expectTypeOf<(typeof app)['~RoutesInput']['typed']['post']['query']>().toEqualTypeOf<{
		text: string
		flag: boolean
		mixed: number | string
	}>()
	expectTypeOf<(typeof app)['~RoutesInput']['typed']['post']['headers']>().toEqualTypeOf<{
		count: unknown
	}>()
	expectTypeOf<(typeof app)['~RoutesInput']['typed']['post']['params']>().toEqualTypeOf<{
		id: number | string
	}>()

	type InputRoutes = InferElysiaRoutesInput<typeof app>

	expectTypeOf<InputRoutes['typed']['post']['body']>().toEqualTypeOf<string>()
	expectTypeOf<InputRoutes['typed']['post']['query']>().toEqualTypeOf<{
		text: string
		flag: boolean
		mixed: number | string
	}>()
	expectTypeOf<InputRoutes['typed']['post']['headers']>().toEqualTypeOf<{
		count: unknown
	}>()
	expectTypeOf<InputRoutes['typed']['post']['params']>().toEqualTypeOf<{
		id: number | string
	}>()
}

{
	const transformedObject = t
		.Transform(
			t.Object({
				value: t.String()
			})
		)
		.Decode((value) => ({
			value: Number(value.value)
		}))
		.Encode((value) => ({
			value: value.value.toString()
		}))

	expectTypeOf<UnwrapBodySchemaInput<typeof transformedObject>>().toEqualTypeOf<{
		value: string
	}>()

	const app = new Elysia().post(
		'/typebox',
		({ body }) => ({ ok: body.value > 0 }),
		{
			body: transformedObject,
			query: transformedObject,
			headers: transformedObject,
			params: transformedObject,
			response: t.Object({
				ok: t.Boolean()
			})
		}
	)

	expectTypeOf<(typeof app)['~Routes']['typebox']['post']['body']>().toEqualTypeOf<{
		value: number
	}>()
	expectTypeOf<(typeof app)['~Routes']['typebox']['post']['query']>().toEqualTypeOf<{
		value: number
	}>()
	expectTypeOf<(typeof app)['~Routes']['typebox']['post']['headers']>().toEqualTypeOf<{
		value: number
	}>()
	expectTypeOf<(typeof app)['~Routes']['typebox']['post']['params']>().toEqualTypeOf<{
		value: number
	}>()
	expectTypeOf<(typeof app)['~Routes']['typebox']['post']['response'][200]>().toEqualTypeOf<{
		ok: boolean
	}>()

	type InputRoutes = InferElysiaRoutesInput<typeof app>

	expectTypeOf<InputRoutes['typebox']['post']['body']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<InputRoutes['typebox']['post']['query']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<InputRoutes['typebox']['post']['headers']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<InputRoutes['typebox']['post']['params']>().toEqualTypeOf<{
		value: string
	}>()
}

{
	const deepZod = z.object({
		level1: z.object({
			level2: z.object({
				numericText: z.string().transform((value) => parseInt(value)),
				obj: z.object({
					toggled: z.string().transform((value) => value === 'true')
				})
			}),
			list: z.array(
				z.object({
					count: z.string().transform((value) => Number(value))
				})
			)
		})
	})

	const app = new Elysia().post(
		'/zod-deep',
		({ body }) => ({
			sum: body.level1.level2.numericText + body.level1.list[0].count,
			flag: body.level1.level2.obj.toggled
		}),
		{
			body: deepZod,
			response: z.object({
				sum: z.number(),
				flag: z.boolean()
			})
		}
	)

	expectTypeOf<(typeof app)['~Routes']['zod-deep']['post']['body']>().toEqualTypeOf<{
		level1: {
			level2: {
				numericText: number
				obj: {
					toggled: boolean
				}
			}
			list: {
				count: number
			}[]
		}
	}>()

	expectTypeOf<(typeof app)['~RoutesInput']['zod-deep']['post']['body']>().toEqualTypeOf<{
		level1: {
			level2: {
				numericText: string
				obj: {
					toggled: string
				}
			}
			list: {
				count: string
			}[]
		}
	}>()
}

{
	const deepTypebox = t.Object({
		level1: t.Object({
			level2: t.Object({
				numericText: t
					.Transform(t.String())
					.Decode((value) => Number(value))
					.Encode((value) => value.toString()),
				obj: t.Object({
					toggled: t
						.Transform(t.String())
						.Decode((value) => value === 'true')
						.Encode((value) => (value ? 'true' : 'false'))
				})
			}),
			list: t.Array(
				t.Object({
					count: t
						.Transform(t.String())
						.Decode((value) => Number(value))
						.Encode((value) => value.toString())
				})
			)
		})
	})

	expectTypeOf<
		UnwrapBodySchemaInput<typeof deepTypebox>['level1']['level2']['numericText']
	>().toEqualTypeOf<string>()
	expectTypeOf<
		UnwrapBodySchemaInput<typeof deepTypebox>['level1']['level2']['obj']['toggled']
	>().toEqualTypeOf<string>()
	expectTypeOf<
		UnwrapBodySchemaInput<typeof deepTypebox>['level1']['list'][number]['count']
	>().toEqualTypeOf<string>()

	const app = new Elysia().post(
		'/typebox-deep',
		({ body }) => ({
			sum: body.level1.level2.numericText + body.level1.list[0].count,
			flag: body.level1.level2.obj.toggled
		}),
		{
			body: deepTypebox,
			response: t.Object({
				sum: t.Number(),
				flag: t.Boolean()
			})
		}
	)

	expectTypeOf<(typeof app)['~Routes']['typebox-deep']['post']['body']>().toEqualTypeOf<{
		level1: {
			level2: {
				numericText: number
				obj: {
					toggled: boolean
				}
			}
			list: {
				count: number
			}[]
		}
	}>()

	expectTypeOf<
		(typeof app)['~RoutesInput']['typebox-deep']['post']['body']['level1']['level2']['numericText']
	>().toEqualTypeOf<string>()
	expectTypeOf<
		(typeof app)['~RoutesInput']['typebox-deep']['post']['body']['level1']['level2']['obj']['toggled']
	>().toEqualTypeOf<string>()
	expectTypeOf<
		(typeof app)['~RoutesInput']['typebox-deep']['post']['body']['level1']['list'][number]['count']
	>().toEqualTypeOf<string>()
}
