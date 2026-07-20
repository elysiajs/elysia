import { Compile } from 'typebox/schema'
import type { TSchema } from 'typebox/type'

export function compileDetachedCheck(
	context: Record<string, TSchema>,
	schema: TSchema,
	lane: 'clean' | 'default' | 'convert' | 'codec'
) {
	const validator = Compile(context, schema) as any
	const check = validator.evaluateResult?.check as
		| ((value: unknown) => boolean)
		| undefined
	if (!check)
		throw new Error(
			`[Elysia] Unable to materialize a detached TypeBox ${lane} check.`
		)
	validator.evaluateResult.code = undefined
	validator.buildResult.functions = undefined
	return check
}
