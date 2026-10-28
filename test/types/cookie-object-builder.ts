/* eslint-disable @typescript-eslint/no-unused-vars */

import { Elysia, t } from '../../src'
import type * as TypeBox from 'typebox/type'

import { expectTypeOf } from 'expect-type'

// ? the object builders keep the t.Cookie config at runtime and TypeBox's types
{
	expectTypeOf(t.Composite).toEqualTypeOf<typeof TypeBox.Composite>()
	expectTypeOf(t.Evaluate).toEqualTypeOf<typeof TypeBox.Evaluate>()
	expectTypeOf(t.Interface).toEqualTypeOf<typeof TypeBox.Interface>()
	expectTypeOf(t.Mapped).toEqualTypeOf<typeof TypeBox.Mapped>()
	expectTypeOf(t.Partial).toEqualTypeOf<typeof TypeBox.Partial>()
	expectTypeOf(t.Required).toEqualTypeOf<typeof TypeBox.Required>()
	expectTypeOf(t.Pick).toEqualTypeOf<typeof TypeBox.Pick>()
	expectTypeOf(t.Omit).toEqualTypeOf<typeof TypeBox.Omit>()
	expectTypeOf(t.ReadonlyObject).toEqualTypeOf<
		typeof TypeBox.ReadonlyObject
	>()

	const session = t.Cookie(
		{ session: t.String(), theme: t.String() },
		{ secrets: 'secret', sign: ['session'] }
	)

	new Elysia().get(
		'/',
		{ cookie: t.Pick(session, ['session']) },
		({ cookie }) => {
			expectTypeOf(cookie.session.value).toEqualTypeOf<string>()
		}
	)

	new Elysia().get(
		'/',
		{ cookie: t.Partial(t.Pick(session, ['session'])) },
		({ cookie }) => {
			expectTypeOf(cookie.session.value).toEqualTypeOf<
				string | undefined
			>()
		}
	)
}
