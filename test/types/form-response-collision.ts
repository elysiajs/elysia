/* eslint-disable @typescript-eslint/no-unused-vars */
import { t, Elysia, form, file } from '../../src'
import type { ElysiaFormData } from '../../src/types'

import { expectTypeOf } from 'expect-type'

// `~ely-form` is a runtime symbol (Symbol.for), so a plain object response may
// legitimately carry a string field literally named `~ely-form`.
// Form detection must key on FormData, not on the presence of that field.

// ? A plain object carrying `~ely-form` stays a plain object
{
	const app = new Elysia().get(
		'/x',
		{
			response: t.Object({
				'~ely-form': t.String()
			})
		},
		() => ({ '~ely-form': 'x' })
	)

	expectTypeOf<
		(typeof app)['~Routes']['x']['get']['response'][200]
	>().toEqualTypeOf<{ '~ely-form': string }>()
}

// ? A plain object carrying `~ely-form` does not accept a form
{
	new Elysia().get(
		'/x',
		{
			response: t.Object({
				'~ely-form': t.String()
			})
		},
		// @ts-expect-error a form is not a plain object response
		() => form({ '~ely-form': 'x' })
	)
}

// ? An actual form is still detected
{
	const app = new Elysia().get(
		'/form',
		{
			response: t.Form({
				a: t.String()
			})
		},
		() => form({ a: 'a' })
	)

	expectTypeOf<
		(typeof app)['~Routes']['form']['get']['response'][200]
	>().toEqualTypeOf<ElysiaFormData<{ a: string }>>()
}

// ? An actual form holding a file is still detected
{
	const app = new Elysia().get(
		'/file',
		{
			response: t.Form({
				f: t.File()
			})
		},
		() => form({ f: file('test/kyuukurarin.mp4') })
	)

	expectTypeOf<
		(typeof app)['~Routes']['file']['get']['response'][200]
	>().toEqualTypeOf<ElysiaFormData<{ f: File }>>()
}

// ? A form whose own field is named `~ely-form` is still detected
{
	const app = new Elysia().get(
		'/collide',
		{
			response: t.Form({
				'~ely-form': t.String()
			})
		},
		() => form({ '~ely-form': 'x' })
	)

	expectTypeOf<
		(typeof app)['~Routes']['collide']['get']['response'][200]
	>().toEqualTypeOf<ElysiaFormData<{ '~ely-form': string }>>()
}

// ? A bare FormData response is not an Elysia form
// Pins the `~ely-form` half of the conjunction: keying on FormData alone would
// misreport this as ElysiaFormData<{}>
{
	const app = new Elysia().get(
		'/bare',
		{
			response: t.Unsafe<FormData>({ '~kind': 'FormData' })
		},
		() => new FormData()
	)

	expectTypeOf<
		(typeof app)['~Routes']['bare']['get']['response'][200]
	>().toEqualTypeOf<FormData>()
}
