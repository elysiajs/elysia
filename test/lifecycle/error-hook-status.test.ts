// An error hook's answer decides the status the client gets, so a mapResponse
// hook that branches on `set.status` must already see that status, on a
// generated route exactly as on the root dispatcher (404)

import { describe, expect, it } from 'bun:test'
import { status } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

const answers = {
	status: () => status(418, 'teapot'),
	response: () => new Response('teapot', { status: 418 })
} as const

const define =
	(
		placement: 'app' | 'route',
		answer: keyof typeof answers,
		async: boolean,
		seen: unknown[]
	): Define =>
	(app) => {
		const error = async
			? async () => answers[answer]()
			: () => answers[answer]()

		let base: any = app
		if (placement === 'app') base = base.onError(error)

		return base
			.mapResponse(({ set, path }: any) => {
				seen.push([path, set.status])
			})
			.get('/', placement === 'route' ? { error } : {}, () => {
				throw new Error('x')
			})
	}

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

for (const lane of lanes)
	describe(`error hook status reaches mapResponse (${lane.id})`, () => {
		for (const placement of ['app', 'route'] as const)
			for (const answer of ['status', 'response'] as const)
				for (const async of [false, true])
					it(`${placement} hook, ${async ? 'async' : 'sync'}, returns ${answer}`, async () => {
						const seen: unknown[] = []
						const instance = await lane.make(
							define(placement, answer, async, seen)
						)

						try {
							const route = await instance.handle(
								new Request('http://localhost/')
							)
							expect(route.status).toBe(418)
							await expect(route.text()).resolves.toBe('teapot')

							// root dispatcher reference: only an app hook covers a 404
							if (placement === 'app') {
								const missing = await instance.handle(
									new Request('http://localhost/missing')
								)
								expect(missing.status).toBe(418)
								await missing.text()
							}

							expect(seen).toEqual(
								placement === 'app'
									? [
											['/', 418],
											['/missing', 418]
										]
									: [['/', 418]]
							)
						} finally {
							await instance.dispose()
						}
					})
	})
