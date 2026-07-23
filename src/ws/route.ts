import { nullObject } from '../utils'
import type { RuntimeServerBinding } from '../generation'
import {
	Capture,
	type FrozenValidator,
	type ValidatorSlot
} from '../compile/aot'
import {
	composeRouteHook,
	localMacroRoot,
	resolveWSLocalHook
} from '../compile/handler'

import {
	createWSContextPrototype,
	buildWSRoutePlan,
	type FrozenWSRouteResult
} from './runtime'

import type { AnyElysia } from '../base'
import type { AnyWSLocalHook } from './types'
import type { InternalRoute, AppHook } from '../types'

export {
	buildGlobalWSHandler,
	buildWebSocketRuntime,
	createWSContextPrototype,
	drainWaiters,
	handleWSResponse
} from './runtime'

export function buildWSRoute(
	route: InternalRoute,
	app: AnyElysia,
	serverBinding?: RuntimeServerBinding,
	contextPrototype = createWSContextPrototype(app),
	frozenSlots?: Partial<Record<ValidatorSlot, FrozenValidator>>
): FrozenWSRouteResult {
	const localHook = route[4] as AnyWSLocalHook | undefined
	const hook = (resolveWSLocalHook(
		localMacroRoot(
			(route[7] as AnyElysia) ?? (route[3] as AnyElysia) ?? app,
			app
		),
		localHook,
		app
	) ?? nullObject()) as AnyWSLocalHook
	const flatAppHook =
		(composeRouteHook(
			(route[3] as AnyElysia | undefined) ?? app,
			undefined,
			route[5] as Parameters<typeof composeRouteHook>[2],
			route[6] as Parameters<typeof composeRouteHook>[3],
			app,
			route[7] as AnyElysia | undefined
		) as Partial<AppHook> | undefined) ?? {}
	const result = buildWSRoutePlan({
		path: route[1] as string,
		hook,
		flatAppHook,
		app,
		serverBinding,
		contextPrototype,
		frozenSlots
	})

	if (Capture.isCapturing()) {
		const ambient = [
			flatAppHook.transform,
			flatAppHook.beforeHandle,
			flatAppHook.afterHandle,
			flatAppHook.mapResponse,
			flatAppHook.afterResponse,
			flatAppHook.error
		].some((value) =>
			Array.isArray(value) ? value.length !== 0 : value != null
		)
		const path = route[1] as string
		if (hook !== localHook || ambient)
			Capture.ws({
				path,
				reason:
					'WebSocket route has resolved macro, inherited, or ambient lifecycle state.'
			})
		else {
			const roles = Object.keys(hook as any).sort()
			const plan = result[2].plan
			const descriptor = {
				roles,
				message: {
					certifiedSync: plan.certifiedSyncMessage,
					needsView: plan.needsMessageView
				}
			}
			Capture.ws({
				path,
				roles,
				source: `(i,p,h,r,s,v)=>buildFrozenWSRoute(i,p,h,r,s,${JSON.stringify(descriptor)},v)`
			})
		}
	}

	return result
}
