import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

export const lanes: LaneFactory[] = [
	jitHandle,
	precompileHandle,
	aotReconstructHandle
]

export const log: string[] = []
export const mark = (name: string) => () => {
	log.push(name)
}
export const throwing = () => {
	throw new Error('boom')
}
export const ok = () => 'ok'
export const named = (name: string, seed?: unknown) =>
	new Elysia(seed === undefined ? { name } : { name, seed }) as any

export interface Case {
	name: string
	define: Define
	expect: Record<string, string>
	afterResponse?: boolean
	body?: true
}

const run = async (lane: LaneFactory, c: Case) => {
	const instance = await lane.make(c.define)
	const out: Record<string, string> = {}

	try {
		for (const path in c.expect) {
			log.length = 0
			const response = await instance.handle(
				new Request(`http://localhost${path}`)
			)
			const text = await response.text()
			if (c.afterResponse) await Bun.sleep(5)
			out[path] = c.body
				? `${response.status} ${text} ${log.join(',')}`
				: `${response.status} ${log.join(',')}`
		}
	} finally {
		await instance.dispose()
	}

	return out
}

export const table = (title: string, cases: Case[]) => {
	for (const lane of lanes)
		describe(`${title} (${lane.id})`, () => {
			for (const c of cases)
				it(c.name, async () => {
					expect(await run(lane, c)).toEqual(c.expect)
				})
		})
}
