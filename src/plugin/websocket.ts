import { Elysia } from '../index'
import {
	buildWSRoute,
	buildGlobalWSHandler,
	resolveWSOptions,
	accumulateWSOptions
} from '../ws/route'

import { fnv1a, nullObject } from '../utils'
import type { WSCapability, WSOptions, WSOptionsEntry } from '../ws/types'

/**
 * ### elysia/websocket
 *
 * Runtime WebSocket capability. Register it once so `.ws()` (and any
 * inherited/scoped WS route) has a provider to build against:
 *
 * ```ts
 * import { Elysia } from 'elysia'
 * import { websocket } from 'elysia/websocket'
 *
 * new Elysia()
 *     .use(websocket())
 *     .ws('/chat', { message(ws, body) { ws.send(body) } })
 * ```
 *
 * Pass app-wide server-tuning defaults (the former `ElysiaConfig.websocket`):
 *
 * ```ts
 * .use(websocket({ idleTimeout: 60, maxPayloadLength: 1024 }))
 * ```
 */

const provider = {
	id: '@elysia/websocket@' + import.meta.url,
	buildWSRoute,
	buildGlobalWSHandler,
	resolveOptions: resolveWSOptions,
	accumulateOptions: accumulateWSOptions
} as const satisfies WSCapability

function stable(value: unknown): unknown {
	if (value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) return value.map(stable)

	const out: Record<string, unknown> = nullObject()
	for (const key of Object.keys(value as object).sort())
		out[key] = stable((value as Record<string, unknown>)[key])

	return out
}

const checksum = (options?: WSOptions) =>
	options === undefined ? 0 : fnv1a(JSON.stringify(stable(options)))

export const websocket = (options?: WSOptions): Elysia => {
	const cs = checksum(options)

	const app = new Elysia({
		name: '@elysia/websocket',
		seed: provider.id + '\0' + cs
	})

	const capabilityOptions: WSOptionsEntry[] | undefined =
		options === undefined
			? undefined
			: [
					{
						depth: 0,
						value: options,
						origin:
							'@elysia/websocket\0' + import.meta.url + '\0' + cs
					}
				]

	;(
		app as unknown as {
			'~ext': {
				capability: {
					ws: {
						provider: WSCapability
						options?: WSOptionsEntry[]
					}
				}
			}
		}
	)['~ext'] = {
		capability: { ws: { provider, options: capabilityOptions } }
	}

	return app
}
