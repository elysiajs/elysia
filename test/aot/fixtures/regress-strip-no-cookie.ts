import { Elysia, t } from '../../../src'

// A fully-precompilable app that never touches cookies. No route surfaces the
// `cc` alias, so the request-side cookie machinery (parse / jar / signing) is
// safe to stub.
export const app = new Elysia().post(
	'/echo',
	{ body: t.Object({ name: t.String() }) },
	({ body }) => body
)
