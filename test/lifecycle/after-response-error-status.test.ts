// Pre-yield failures must run `afterResponse` once, after error handling, with status 500.

import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

const settle = () => Bun.sleep(20)

const drain = async (response: Response) => {
	try {
		await response.text()
	} catch {}
}

type Log = string[]

interface Observed {
	log: Log
	status: number
}

const placements = ['none', 'app', 'route'] as const
const shapes = ['bare', 'error-hook', 'tracer'] as const

type Placement = (typeof placements)[number]
type Shape = (typeof shapes)[number]

const define = (
	placement: Placement,
	shape: Shape,
	handler: unknown,
	log: Log
): Define => {
	const afterResponse = ({ set }: any) => {
		log.push(`afterResponse:${set.status}`)
	}

	return (base) => {
		let app: any = base

		if (shape === 'tracer') app = app.use(trace()).trace(() => {})
		if (placement === 'app') app = app.afterResponse(afterResponse)

		return app.get(
			'/',
			{
				...(placement === 'route' ? { afterResponse } : {}),
				...(shape === 'error-hook'
					? {
							error({ error }: any) {
								log.push(`error:${(error as Error).message}`)
							}
						}
					: {})
			},
			handler
		)
	}
}

const run = async (
	lane: LaneFactory,
	definition: Define,
	log: Log
): Promise<Observed> => {
	const instance = await lane.make(definition)
	try {
		const response = await instance.handle(new Request('http://localhost/'))
		await drain(response)
		await settle()

		return { log, status: response.status }
	} finally {
		await instance.dispose()
	}
}

const handlers = {
	sync: () =>
		function* () {
			throw new Error('boom')
		},
	async: () =>
		async function* () {
			throw new Error('boom')
		}
} as const

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

for (const lane of lanes)
	describe(`pre-yield generator throw — afterResponse contract (${lane.id})`, () => {
		for (const kind of ['sync', 'async'] as const)
			for (const placement of placements)
				for (const shape of shapes) {
					// This fast lane intentionally schedules before mapping.
					const syncFastLane =
						kind === 'sync' &&
						placement !== 'none' &&
						shape === 'bare'

					it(`${kind} generator, ${placement} hook, ${shape}`, async () => {
						const log: Log = []
						const { status } = await run(
							lane,
							define(placement, shape, handlers[kind](), log),
							log
						)

						expect(status).toBe(500)

						if (placement === 'none') {
							expect(
								log.filter((entry) =>
									entry.startsWith('afterResponse')
								)
							).toHaveLength(0)

							if (shape === 'error-hook')
								expect(log).toEqual(['error:boom'])

							return
						}

						const fired = log.filter((entry) =>
							entry.startsWith('afterResponse')
						)

						expect(fired).toHaveLength(1)

						if (shape === 'error-hook')
							expect(log[0]).toBe('error:boom')

						expect(fired[0]).toBe(
							syncFastLane
								? 'afterResponse:undefined'
								: 'afterResponse:500'
						)
					})
				}
	})
