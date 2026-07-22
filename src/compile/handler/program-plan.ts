import {
	RouteEffect,
	type ResponseMode,
	type RouteCompileState
} from './descriptor'
import {
	ResponseSink,
	ROUTE_PROGRAM_VERSION,
	type RouteProgram
} from './program'

export type RouteProgramFallbackReason = true | 'legacy-lane'

export type RouteProgramPlan =
	| { program: RouteProgram }
	| { fallback: RouteProgramFallbackReason }

const legacyLane = new WeakSet<object>()

/** @internal D2 oracle seam; production callers never opt in. */
export function useLegacyRouteProgramLane(app: object) {
	legacyLane.add(app)
}

const responseSinks: Record<ResponseMode, RouteProgram[1]> = {
	compact: ResponseSink.Compact,
	set: ResponseSink.Set,
	'default-headers': ResponseSink.DefaultHeaders,
	'set-with-default-headers': ResponseSink.SetWithDefaultHeaders
}

export function responseRouteProgram(
	responseMode: ResponseMode,
	materializeDefaultHeaders: boolean
): RouteProgram {
	return [
		ROUTE_PROGRAM_VERSION,
		responseMode === 'set-with-default-headers' &&
		!materializeDefaultHeaders
			? ResponseSink.Set
			: responseSinks[responseMode]
	]
}

export function planRouteProgram(
	state: RouteCompileState,
	handler: unknown,
	compatCancellation: boolean,
	app?: object
): RouteProgramPlan {
	const { descriptor } = state

	if (app && legacyLane.has(app)) return { fallback: 'legacy-lane' }
	if (compatCancellation) return { fallback: true }
	if (descriptor.handlerKind !== 'function' || typeof handler !== 'function')
		return { fallback: true }
	if (descriptor.handlerIsAsync || descriptor.async)
		return { fallback: true }
	if (handler.constructor.name.endsWith('GeneratorFunction'))
		return { fallback: true }
	if (descriptor.bodyPlan.enabled || descriptor.hasBody)
		return { fallback: true }
	if (state.cookieConfig !== undefined) return { fallback: true }
	if (descriptor.hasLifecycleHook) return { fallback: true }
	if (descriptor.hasTrace) return { fallback: true }
	if (descriptor.hasResponseValidator)
		return { fallback: true }
	if (state.vali !== undefined) return { fallback: true }
	if (descriptor.effectMask & ~RouteEffect.SetHeaders)
		return { fallback: true }
	if (
		descriptor.responseMode === 'set-with-default-headers' &&
		!(descriptor.effectMask & RouteEffect.SetHeaders)
	)
		return { fallback: true }
	if (
		descriptor.responseMode === 'default-headers' &&
		state.defaultResponseState === undefined
	)
		return { fallback: true }

	return {
		program: responseRouteProgram(
			descriptor.responseMode,
			!!(descriptor.effectMask & RouteEffect.SetHeaders)
		)
	}
}
