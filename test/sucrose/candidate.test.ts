// @ts-nocheck
import { describe, expect, it } from 'bun:test'

import {
	clearSucroseCache,
	sucroseCandidate,
	sucroseOracle
} from '../../src/sucrose'
import { beginCompilerSession, endCompilerSession } from '../../src/compile/aot'
import { fnv1a } from '../../src/utils'
import { fixtures } from './fixtures'

const flags = ['query', 'headers', 'body', 'cookie', 'set', 'route'] as const

const allTrue = (value: any) => flags.every((flag) => value[flag] === true)

describe('Sucrose N+1 candidate', () => {
	it('matches the oracle on the 29 semantic fixtures', () => {
		for (const fixture of fixtures)
			expect(sucroseCandidate(fixture.fn, undefined)).toEqual(
				sucroseOracle(fixture.fn, undefined)
			)
	})

	it('skips comments, strings, template text, and regex bodies', () => {
		const inferred = sucroseCandidate((c: any) => {
			// c.body
			const text = 'c.cookie'
			const regex = /c\.headers/u
			return `${text} c.set ${regex} ${c.query.value}`
		}, undefined)

		expect(inferred).toEqual({
			query: true,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: false
		})
	})

	it('distinguishes division and scans template substitutions', () => {
		const inferred = sucroseCandidate(
			(c: any) => `${10 / c.body.count}:${c.headers.host}`,
			undefined
		)
		expect(inferred.body).toBe(true)
		expect(inferred.headers).toBe(true)
		expect(inferred.query).toBe(false)
	})

	it('keeps context access after postfix division', () => {
		const inferred = sucroseCandidate((c: any) => {
			let x = 1
			return x++ / Number(c.query.value) / 2
		}, undefined)

		expect(inferred.query).toBe(true)
		expect(inferred.body).toBe(false)
	})

	it('handles Unicode aliases and static computed access', () => {
		const inferred = sucroseCandidate(
			(上下文: any) => 上下文['headers'],
			undefined
		)
		expect(inferred.headers).toBe(true)
		expect(inferred.body).toBe(false)
	})

	it('handles static computed destructuring and widens unknown keys', () => {
		const parameter = ({ ['query']: q }: any) => q.value
		const body = (context: any) => {
			const { ['headers']: h } = context
			return h.host
		}
		const dynamic = ({ [Date.now()]: value }: any) => value

		expect(sucroseCandidate(parameter, undefined)).toEqual({
			query: true,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: false
		})
		expect(sucroseCandidate(body, undefined).headers).toBe(true)
		expect(sucroseCandidate(dynamic, undefined)).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			route: true
		})
	})

	it('fixes the computed-destructuring false floor over the oracle', () => {
		const handler = ({ ['query']: q }: any) => q.value

		// The old scanner silently omitted the channel and produced undefined at
		// runtime; the candidate must conservatively materialize it.
		expect(sucroseOracle(handler, undefined).query).toBe(false)
		expect(sucroseCandidate(handler, undefined).query).toBe(true)
	})

	it('uses the outer callable signature when the body contains arrows', () => {
		const inferred = sucroseCandidate(function (context: any) {
			const read = (value: any) => value.name
			void read
			return context.headers['x-test']
		}, undefined)

		expect(inferred.headers).toBe(true)
		expect(inferred.query).toBe(false)
	})

	it('keeps zero-parameter handlers context-free', () => {
		for (const handler of [() => 'ok', function () {}, async () => 'ok'])
			expect(sucroseCandidate(handler, undefined)).toEqual({
				query: false,
				headers: false,
				body: false,
				cookie: false,
				set: false,
				route: false
			})
	})

	it('widens dynamic access, forwarding, arguments, and eval', () => {
		const cases = [
			(c: any) => c[Date.now()],
			(c: any) => opaque(c),
			function (c: any) {
				return arguments[0]
			},
			(c: any) => eval('c.query')
		]

		for (const handler of cases)
			expect(allTrue(sucroseCandidate(handler, undefined))).toBe(true)
	})

	it('widens forged, native, and bound sources', () => {
		const forged = (c: any) => c.query
		Object.defineProperty(forged, 'toString', {
			value: () => '(c) => c.query'
		})

		for (const handler of [
			forged,
			Array.prototype.map,
			((c: any) => c.query).bind(null)
		])
			expect(allTrue(sucroseCandidate(handler, undefined))).toBe(true)
	})

	it('includes lifecycle inference and returns immutable results', () => {
		const inferred = sucroseCandidate(() => 'ok', {
			beforeHandle: [(c: any) => c.set.status]
		} as any)

		expect(inferred.set).toBe(true)
		expect(Object.isFrozen(inferred)).toBe(true)
	})

	it('keeps the session cache collision-safe and byte-bounded', () => {
		const app = {}
		const session = beginCompilerSession(app)
		try {
			const collisionProbe = new Function('c', 'return c.body')
			const content = Function.prototype.toString.call(collisionProbe)
			const key = `candidate:${fnv1a(content)}`
			session.sucroseCache.set(key, {
				content: 'different source with the same hash slot',
				inference: Object.freeze({
					query: true,
					headers: false,
					body: false,
					cookie: false,
					set: false,
					route: false
				}),
				bytes: 128
			})
			session.sucroseCacheBytes = 128

			expect(
				sucroseCandidate(collisionProbe as any, undefined).body
			).toBe(true)

			for (let i = 0; i < 180; i++)
				sucroseCandidate(
					new Function(
						'c',
						`void ${i};${' '.repeat(8 * 1024)}return c.query`
					) as any,
					undefined
				)

			expect(session.sucroseCacheBytes).toBeLessThanOrEqual(1024 * 1024)
			for (const cached of session.sucroseCache.values())
				expect(Object.isFrozen(cached.inference)).toBe(true)
		} finally {
			endCompilerSession(app, session)
		}
	})
})

const transitiveAliasHandler = (size: number, nonce: number) => {
	const emptyLength = new Function('c', '').toString().length
	const prefix = `void ${nonce};let a0=c;`
	const bodyLength = size - emptyLength
	let body = prefix
	let alias = 0
	for (;;) {
		const next = alias + 1
		const assignment = `let a${next}=a${alias};`
		const suffix = `return a${next}.query`
		if (body.length + assignment.length + suffix.length > bodyLength) break
		body += assignment
		alias = next
	}
	const suffix = `return a${alias}.query`
	return new Function(
		'c',
		body + ' '.repeat(bodyLength - body.length - suffix.length) + suffix
	)
}

describe('Sucrose N+1 candidate slope', () => {
	it('stays linear across 4/8/16/31 KiB transitive aliases', () => {
		clearSucroseCache(0)
		const sizes = [4, 8, 16, 31].map((size) => size * 1024)
		const timings: number[] = []

		for (const size of sizes) {
			const samples: number[] = []
			for (let sample = 0; sample < 7; sample++) {
				const handler = transitiveAliasHandler(size, sample)
				expect(handler.toString().length).toBe(size)
				const started = Bun.nanoseconds()
				const inferred = sucroseCandidate(handler as any, undefined)
				samples.push(Bun.nanoseconds() - started)
				expect(inferred).toEqual({
					query: true,
					headers: false,
					body: false,
					cookie: false,
					set: false,
					route: false
				})
			}
			samples.sort((a, b) => a - b)
			timings.push(samples[3])
		}

		for (let i = 1; i < timings.length; i++)
			expect(timings[i]).toBeLessThan(timings[i - 1] * 6 + 100_000)
		expect(timings[3]).toBeLessThan(20_000_000)
	})
})
