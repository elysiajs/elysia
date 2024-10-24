/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'bun:test'
import { t, Elysia, RouteSchema, Cookie } from '../../src'
import { expectTypeOf } from 'expect-type'

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
