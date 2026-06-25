import { Elysia, t } from '../../../src'

// Fully-precompilable app → handler JIT is stubbed. The JIT-only codegen helpers
// `mapTransform`/`mapError`/`mapAfterResponse` (annotated `/*#__PURE__*/`) must
// then tree-shake out of the bundle even though `compile/handler/utils` stays
// alive for `params.ts` (cloneResponse / hasRequestBody).
export const app = new Elysia().post(
	'/u',
	{ body: t.Object({ name: t.String() }) },
	({ body }) => body
)
