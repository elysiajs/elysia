import { handlerParams } from './param-table'
import type { HandlerParamContext } from './param-resolvers'

/**
 * `vs<i>` / `vr<i>`: status and validator of the route's i-th declared response
 */
export const isResponseParam = (name: string) => /^v[rs]\d+$/.test(name)

export function resolveHandlerParams(names: string[], c: HandlerParamContext) {
	const length = names.length
	if (!length) return []

	const out: unknown[] = new Array(length)
	const params = handlerParams

	for (let i = 0; i < length; i++) {
		const name = names[i]!
		// a response param missing its entry fails the replay instead of
		// skipping validation: no resolver has its name
		const entry =
			isResponseParam(name) &&
			[...((c.vali as any)?.response ?? [])][+name.slice(2)]
		const resolve = params[name]
		if (!entry && !resolve)
			throw new Error(
				`[elysia-aot]: Fail to reconstruct build, missing "${name}" param`
			)

		out[i] = entry ? entry[name[1] === 's' ? 0 : 1] : resolve!(c)
	}

	return out
}
