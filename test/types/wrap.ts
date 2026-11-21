/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, type Context } from '../../src'

import { expectTypeOf } from 'expect-type'

// A wrap's context listener is handed each context Elysia creates for a request
{
	new Elysia().wrap(
		(fetch) => fetch,
		(context) => {
			expectTypeOf(context).toEqualTypeOf<Context>()
		}
	)
}

// It is optional, and what it returns is ignored
{
	new Elysia().wrap((fetch) => fetch)
	new Elysia().wrap(
		(fetch) => fetch,
		() => new Response('ignored')
	)
}

// It is a function
{
	// @ts-expect-error a listener is a function
	new Elysia().wrap((fetch) => fetch, 'listener')
}
