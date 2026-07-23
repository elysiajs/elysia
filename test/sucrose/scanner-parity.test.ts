// @ts-nocheck
// Parity corpus for the single-pass token scanner (ported from sennen's
// candidate corpus). Asserts the scanner satisfies every fixture expectation
// exactly: expected-true channels MUST be true (the forbidden direction is
// silently narrowing an accessed channel) and channels the fixture does not
// claim must stay false unless the fixture is in the documented widening
// allowlist below.
import { describe, expect, it } from 'bun:test'

import { clearSucroseCache, sucrose } from '../../src/sucrose'
import { beginCompilerSession, endCompilerSession } from '../../src/compile/aot'
import { fnv1a } from '../../src/utils'
import { fixtures } from './fixtures'

const flags = ['query', 'headers', 'body', 'cookie', 'set', 'route'] as const

const allTrue = (value: any) => flags.every((flag) => value[flag] === true)

// Fixtures the scanner is deliberately MORE conservative on than the fixture
// claims (extra channels enabled). Empty = exact parity on the whole corpus.
const allowedWidening: Record<string, readonly string[]> = {}

describe('Sucrose scanner parity', () => {
	it('satisfies every semantic fixture exactly (widening only if allowed)', () => {
		for (const fixture of fixtures) {
			const actual = sucrose(fixture.fn, undefined)

			for (const flag of flags) {
				const expected = fixture.expect[flag] ?? false

				if (expected) {
					// Narrowing an accessed channel is forbidden
					expect(`${fixture.name}:${flag}:${actual[flag]}`).toBe(
						`${fixture.name}:${flag}:true`
					)
					continue
				}

				if (actual[flag] === true)
					// Widening must be explicitly documented
					expect(allowedWidening[fixture.name] ?? []).toContain(flag)
			}
		}
	})

	it('skips comments, strings, template text, and regex bodies', () => {
		const inferred = sucrose((c: any) => {
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
		const inferred = sucrose(
			(c: any) => `${10 / c.body.count}:${c.headers.host}`,
			undefined
		)
		expect(inferred.body).toBe(true)
		expect(inferred.headers).toBe(true)
		expect(inferred.query).toBe(false)
	})

	it('keeps context access after postfix division', () => {
		const inferred = sucrose((c: any) => {
			let x = 1
			return x++ / Number(c.query.value) / 2
		}, undefined)

		expect(inferred.query).toBe(true)
		expect(inferred.body).toBe(false)
	})

	it('handles Unicode aliases and static computed access', () => {
		const inferred = sucrose((上下文: any) => 上下文['headers'], undefined)
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

		expect(sucrose(parameter, undefined)).toEqual({
			query: true,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: false
		})
		expect(sucrose(body, undefined).headers).toBe(true)
		expect(sucrose(dynamic, undefined)).toEqual({
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true,
			route: true
		})
	})

	it('materializes computed-destructured channels (old-scanner false floor)', () => {
		// The old regex walk silently omitted the channel and produced
		// undefined at runtime; the scanner must conservatively materialize it.
		const handler = ({ ['query']: q }: any) => q.value

		expect(sucrose(handler, undefined).query).toBe(true)
	})

	it('uses the outer callable signature when the body contains arrows', () => {
		const inferred = sucrose(function (context: any) {
			const read = (value: any) => value.name
			void read
			return context.headers['x-test']
		}, undefined)

		expect(inferred.headers).toBe(true)
		expect(inferred.query).toBe(false)
	})

	it('keeps zero-parameter handlers context-free', () => {
		for (const handler of [() => 'ok', function () {}, async () => 'ok'])
			expect(sucrose(handler, undefined)).toEqual({
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
			expect(allTrue(sucrose(handler, undefined))).toBe(true)
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
			expect(allTrue(sucrose(handler, undefined))).toBe(true)
	})

	it('includes lifecycle inference and returns immutable results', () => {
		const inferred = sucrose(() => 'ok', {
			beforeHandle: [(c: any) => c.set.status]
		} as any)

		expect(inferred.set).toBe(true)
		expect(Object.isFrozen(inferred)).toBe(true)
	})

	it('keeps the session cache collision-safe and entry-bounded', () => {
		const app = {}
		const session = beginCompilerSession(app)
		try {
			const collisionProbe = new Function('c', 'return c.body')
			const content = Function.prototype.toString.call(collisionProbe)
			const key = fnv1a(content)
			session.sucroseCache.set(key, {
				content: 'different source with the same hash slot',
				inference: Object.freeze({
					query: true,
					headers: false,
					body: false,
					cookie: false,
					set: false,
					route: false
				})
			})

			expect(sucrose(collisionProbe as any, undefined).body).toBe(true)

			for (let i = 0; i < 1100; i++)
				sucrose(
					new Function('c', `void ${i};return c.query`) as any,
					undefined
				)

			expect(session.sucroseCache.size).toBeLessThanOrEqual(1024)
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

describe('Sucrose scanner slope', () => {
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
				const inferred = sucrose(handler as any, undefined)
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
