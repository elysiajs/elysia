import { describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { ValidationPlanMultiValidator } from '../../src/experimental/validation-plan'
import { ValidationError } from '../../src/error'
import { Validator } from '../../src/validator'

const standard = (validate: (value: any) => any) =>
	({
		'~standard': { version: 1, vendor: 'composition-test', validate }
	}) as any

const candidate = (options: Record<string, unknown> = {}) =>
	({
		...options,
		app: { '~config': { experimental: { validationPlan } } }
	}) as any

describe('explicit validator composition', () => {
	it('runs members once in declaration order against the original input', async () => {
		const events: string[] = []
		const first = standard((value) => {
			events.push(`first:${value.shared}`)
			return { value: { first: true, shared: 'first' } }
		})
		const last = standard((value) => {
			events.push(`last:${value.shared}`)
			return { value: { last: true, shared: 'last' } }
		})

		const validator = Validator.create(
			first,
			candidate({ schemas: [last] })
		)!
		const out = await validator.From!({ shared: 'input' }, 'body')

		expect(events).toEqual(['first:input', 'last:input'])
		expect(out).toEqual({ first: true, last: true, shared: 'last' })
	})

	it('does not mutate a shared or frozen member result while merging', () => {
		const shared = Object.freeze({ first: true })
		const validator = Validator.create(
			standard(() => ({ value: shared })),
			candidate({ schemas: [t.Object({ later: t.Number() })] })
		)!

		expect(validator.From!({ later: 1 }, 'body')).toEqual({
			first: true,
			later: 1
		})
		expect(validator.From!({ later: 2 }, 'body')).toEqual({
			first: true,
			later: 2
		})
		expect(shared).toEqual({ first: true })
	})

	it('preserves sparse array shape for every composition member', () => {
		const run = (enabled: boolean) => {
			const seen: unknown[] = []
			const inspect = (value: any[]) => ({
				length: value.length,
				zero: Object.hasOwn(value, 0),
				one: Object.hasOwn(value, 1),
				keys: Object.keys(value)
			})
			const member = (name: string) =>
				standard((value) => {
					seen.push(inspect(value))
					return { value: { [name]: true } }
				})
			const validator = Validator.create(member('first'), {
				schemas: [member('second')],
				app: {
					'~config': {
						experimental: {
							validationPlan: enabled ? validationPlan : undefined
						}
					}
				}
			})!
			const input = new Array(2)
			input[1] = 'present'

			expect(validator.From!(input, 'body')).toEqual({
				first: true,
				second: true
			})
			return seen
		}

		const oracle = run(false)
		expect(run(true)).toEqual(oracle)
		expect(oracle).toEqual([
			{ length: 2, zero: false, one: true, keys: ['1'] },
			{ length: 2, zero: false, one: true, keys: ['1'] }
		])
	})

	it('preserves indexed accessors without invoking them while cloning', () => {
		const run = (enabled: boolean) => {
			let reads = 0
			const getter = () => {
				reads++
				return 'value'
			}
			const input: unknown[] = []
			Object.defineProperty(input, 0, {
				get: getter,
				enumerable: true,
				configurable: false
			})
			const seen: unknown[] = []
			const member = (name: string) =>
				standard((value) => {
					const descriptor = Object.getOwnPropertyDescriptor(value, 0)!
					seen.push({
						accessor: !('value' in descriptor),
						getter: descriptor.get === getter,
						reads
					})
					return { value: { [name]: true } }
				})
			const validator = Validator.create(member('first'), {
				schemas: [member('second')],
				app: {
					'~config': {
						experimental: {
							validationPlan: enabled ? validationPlan : undefined
						}
					}
				}
			})!

			expect(validator.From!(input, 'body')).toEqual({
				first: true,
				second: true
			})
			return { reads, seen }
		}

		const oracle = run(false)
		expect(run(true)).toEqual(oracle)
		expect(oracle).toEqual({
			reads: 0,
			seen: [
				{ accessor: true, getter: true, reads: 0 },
				{ accessor: true, getter: true, reads: 0 }
			]
		})
	})

	it('defines __proto__ as data without mutating Object.prototype', () => {
		const second: Record<string, unknown> = {}
		Object.defineProperty(second, '__proto__', {
			value: { polluted: 'yes' },
			enumerable: true
		})
		const validator = Validator.create(
			standard(() => ({ value: { first: true } })),
			candidate({ schemas: [standard(() => ({ value: second }))] })
		)!

		const output = validator.From!({}, 'body') as Record<string, unknown>
		expect(Object.hasOwn(output, '__proto__')).toBe(true)
		expect(output.__proto__).toEqual({ polluted: 'yes' })
		expect(({} as any).polluted).toBeUndefined()
	})

	it('preserves a schema-declared own __proto__ input for every member', () => {
		const properties: Record<string, any> = {}
		Object.defineProperty(properties, '__proto__', {
			value: t.String(),
			enumerable: true
		})
		const input: Record<string, unknown> = { other: 1 }
		Object.defineProperty(input, '__proto__', {
			value: 'safe',
			enumerable: true
		})
		const validator = Validator.create(
			t.Object(properties, { additionalProperties: false }),
			candidate({
				schemas: [
					t.Object(
						{ other: t.Number() },
						{ additionalProperties: false }
					)
				]
			})
		)!

		const output = validator.From!(input, 'body') as Record<string, unknown>
		expect(output.__proto__).toBe('safe')
		expect(output.other).toBe(1)
		expect(({} as any).safe).toBeUndefined()
	})

	it('keeps sibling object keys but rejects true extras on closed members', () => {
		const validator = Validator.create(
			t.Object({ route: t.Number() }, { additionalProperties: false }),
			candidate({
				schemas: [
					t.Object(
						{ guarded: t.String() },
						{ additionalProperties: false }
					)
				]
			})
		)!

		expect(validator.From!({ route: 1, guarded: 'yes' }, 'body')).toEqual({
			route: 1,
			guarded: 'yes'
		})
		expect(() =>
			validator.From!({ route: 1, guarded: 'yes', extra: true }, 'body')
		).toThrow(ValidationError)
	})

	it('does not validate sibling keys as schema-valued additional properties', () => {
		const validator = Validator.create(
			t.Object(
				{ route: t.Number() },
				{ additionalProperties: t.Number() }
			),
			candidate({ schemas: [t.Object({ guarded: t.String() })] })
		)!

		expect(validator.From!({ route: 1, guarded: 'yes' }, 'body')).toEqual({
			route: 1,
			guarded: 'yes'
		})
		expect(() =>
			validator.From!({ route: 1, guarded: 'yes', extra: 'no' }, 'body')
		).toThrow(ValidationError)
	})

	it('applies each member default without mutating the original input', () => {
		const input: Record<string, unknown> = {}
		const validator = Validator.create(
			t.Object({ route: t.Number({ default: 1 }) }),
			candidate({
				schemas: [t.Object({ guarded: t.String({ default: 'yes' }) })]
			})
		)!

		expect(validator.From!(input, 'body')).toEqual({
			route: 1,
			guarded: 'yes'
		})
		expect(input).toEqual({})
	})

	it('recursively merges nested object members', () => {
		const validator = Validator.create(
			t.Object({ nested: t.Object({ route: t.Number() }) }),
			candidate({
				schemas: [
					t.Object({ nested: t.Object({ guarded: t.String() }) })
				]
			})
		)!

		expect(
			validator.From!({ nested: { route: 1, guarded: 'yes' } }, 'body')
		).toEqual({ nested: { route: 1, guarded: 'yes' } })
	})

	it('distinguishes nested sibling keys from true extras on closed members', () => {
		const closed = (properties: Record<string, any>) =>
			t.Object(properties, { additionalProperties: false })
		const validator = Validator.create(
			closed({ nested: closed({ route: t.Number() }) }),
			candidate({
				schemas: [closed({ nested: closed({ guarded: t.String() }) })]
			})
		)!

		expect(
			validator.From!({ nested: { route: 1, guarded: 'yes' } }, 'body')
		).toEqual({ nested: { route: 1, guarded: 'yes' } })
		expect(() =>
			validator.From!(
				{ nested: { route: 1, guarded: 'yes', extra: true } },
				'body'
			)
		).toThrow(ValidationError)
	})

	it('recursively merges nested defaults', () => {
		const input = { nested: {} }
		const validator = Validator.create(
			t.Object({
				nested: t.Object({ route: t.Number({ default: 1 }) })
			}),
			candidate({
				schemas: [
					t.Object({
						nested: t.Object({
							guarded: t.String({ default: 'yes' })
						})
					})
				]
			})
		)!

		expect(validator.From!(input, 'body')).toEqual({
			nested: { route: 1, guarded: 'yes' }
		})
		expect(input).toEqual({ nested: {} })
	})

	it('fails closed to the legacy oracle for referenced model graphs', () => {
		const models = {
			RouteNested: t.Object(
				{ route: t.Number() },
				{ additionalProperties: false }
			),
			GuardNested: t.Object(
				{ guarded: t.String() },
				{ additionalProperties: false }
			)
		}
		const next = Validator.create(
			t.Object({ nested: t.Ref('RouteNested') }),
			candidate({
				models,
				schemas: [t.Object({ nested: t.Ref('GuardNested') })]
			})
		)!

		expect(next.constructor.name).toBe('TypeBoxValidator')
	})

	it('fails closed to the legacy oracle for object unions', () => {
		const next = Validator.create(
			t.Object({
				nested: t.Union([
					t.Object({ a: t.Number() }),
					t.Object({ x: t.Number() })
				])
			}),
			candidate({
				schemas: [t.Object({ nested: t.Object({ b: t.String() }) })]
			})
		)!

		expect(next.constructor.name).toBe('TypeBoxValidator')
	})

	it('fails closed when an accessor hides an unsupported schema node', () => {
		const route = t.Object({ value: t.String() }) as any
		Object.defineProperty(route.properties, 'hidden', {
			enumerable: true,
			get() {
				return t.Union([t.String(), t.Number()])
			}
		})
		const next = Validator.create(
			route,
			candidate({ schemas: [t.Object({ other: t.String() })] })
		)!

		expect(next.constructor.name).toBe('TypeBoxValidator')
	})

	it('uses ordered later-wins semantics for scalar outputs', () => {
		const validator = Validator.create(
			t.String(),
			candidate({ schemas: [t.String({ minLength: 2 })] })
		)!

		expect(validator.Check('ok')).toBe(true)
		expect(validator.From!('ok', 'body')).toBe('ok')
		expect(() => validator.From!('x', 'body')).toThrow(ValidationError)
	})

	it('pins later-wins for mismatched top-level member outputs', () => {
		const validator = Validator.create(
			standard(() => ({ value: { first: true } })),
			candidate({ schemas: [standard(() => ({ value: 'last' }))] })
		)!

		expect(validator.From!({}, 'body')).toBe('last')
	})

	it('uses later-wins for nested arrays and exotic values', () => {
		const first = {
			nested: {
				items: [1],
				date: new Date('2020-01-01T00:00:00.000Z'),
				map: new Map([['value', 1]])
			}
		}
		const last = {
			nested: {
				items: [2],
				date: new Date('2021-01-01T00:00:00.000Z'),
				map: new Map([['value', 2]])
			}
		}
		const validator = Validator.create(
			standard(() => ({ value: first })),
			candidate({ schemas: [standard(() => ({ value: last }))] })
		)!
		const output = validator.From!({}, 'body') as typeof last

		expect(output.nested.items).toEqual([2])
		expect(output.nested.date.toISOString()).toBe(
			'2021-01-01T00:00:00.000Z'
		)
		expect(output.nested.map.get('value')).toBe(2)
	})

	it('keeps top-level array append semantics', () => {
		const validator = Validator.create(
			standard(() => ({ value: [1] })),
			candidate({ schemas: [standard(() => ({ value: [2] }))] })
		)!

		expect(validator.From!({}, 'body')).toEqual([1, 2])
	})

	it('merges cyclic plain records without recursion overflow', () => {
		const first: any = { value: 1 }
		first.self = first
		const last: any = { value: 2 }
		last.self = last
		const validator = Validator.create(
			standard(() => ({ value: { node: first } })),
			candidate({
				schemas: [standard(() => ({ value: { node: last } }))]
			})
		)!
		const output = validator.From!({}, 'body') as any

		expect(output.node.value).toBe(2)
		expect(output.node.self).toBe(output.node)
	})

	it('clones a later shared plain-record replacement', () => {
		const shared = { safe: true }
		const validator = Validator.create(
			standard(() => ({ value: 1 })),
			candidate({ schemas: [standard(() => ({ value: shared }))] })
		)!
		const output = validator.From!({}, 'body') as typeof shared

		expect(output).toEqual(shared)
		expect(output).not.toBe(shared)
	})

	it('clones known-safe root Date, Map, and Set outputs', () => {
		const values = [
			new Date('2020-01-01T00:00:00.000Z'),
			new Map([['value', 1]]),
			new Set([1])
		]

		for (const shared of values) {
			const validator = Validator.create(
				standard(() => ({ value: shared })),
				candidate({ schemas: [standard(() => ({ value: shared }))] })
			)!
			const output = validator.From!({}, 'body') as any

			expect(Object.getPrototypeOf(output)).toBe(
				Object.getPrototypeOf(shared)
			)
			expect(output).not.toBe(shared)
		}
	})

	it('preserves opaque host values without manufacturing invalid shells', () => {
		const values = [/a/gi, new URL('https://example.com/path')]

		for (const value of values) {
			const validator = Validator.create(
				standard(() => ({ value })),
				candidate({ schemas: [standard(() => ({ value }))] })
			)!
			const output = validator.From!({}, 'body') as RegExp | URL

			expect(output).toBe(value)
			if (output instanceof RegExp) expect(output.source).toBe('a')
			else expect(output.href).toBe('https://example.com/path')
		}
	})

	it('preserves File internal slots in composed TypeBox input', async () => {
		const file = new File(['body'], 'test.txt', { type: 'text/plain' })
		const validator = Validator.create(
			t.Object({ file: t.File() }),
			candidate({ schemas: [t.Object({ name: t.String() })] })
		)!

		const output = (await validator.From!(
			{ file, name: 'ok' },
			'body',
			true
		)) as any
		expect(output.file).toBe(file)
		expect(output.file.name).toBe('test.txt')
		expect(output.name).toBe('ok')
	})

	it('keeps the legacy oracle separate from the validation-plan candidate', () => {
		const route = t.Object({ route: t.Number() })
		const guard = t.Object({ guarded: t.String() })
		const legacy = Validator.create(route, {
			schemas: [guard],
			app: { '~config': { experimental: { validationPlan: undefined } } }
		})!
		const next = Validator.create(route, candidate({ schemas: [guard] }))!

		expect(legacy.constructor.name).toBe('TypeBoxValidator')
		expect(next.constructor.name).toBe('ValidationPlanMultiValidator')
	})

	it('does not inspect opaque Standard metadata in either selector lane', () => {
		const vendor = standard((value) => ({ value })) as any
		vendor.metadata = new Proxy(
			{ nested: t.Ref('opaque-vendor-data') },
			{
				ownKeys() {
					throw new Error('metadata walked')
				}
			}
		)
		const guard = standard((value) => ({ value }))
		const legacy = Validator.create(vendor, {
			schemas: [guard],
			app: { '~config': { experimental: { validationPlan: undefined } } }
		})!
		const next = Validator.create(vendor, candidate({ schemas: [guard] }))!

		expect(legacy.constructor.name).toBe('LegacyMultiValidator')
		expect(next.constructor.name).toBe('ValidationPlanMultiValidator')
		expect(next).toBeInstanceOf(ValidationPlanMultiValidator)
	})

	it('falls back for obsolete boolean configuration at runtime', () => {
		const route = t.Object({ route: t.Number() })
		const guard = standard((value) => ({ value }))
		const validator = Validator.create(route, {
			schemas: [guard],
			app: {
				'~config': {
					experimental: { validationPlan: false as any }
				}
			}
		})!

		expect(validator.constructor.name).toBe('LegacyMultiValidator')
	})

	it('makes old and new member ordering mechanically observable', () => {
		const run = (enabled: boolean) => {
			const events: string[] = []
			const coded = t
				.Codec(t.String())
				.Decode((value) => {
					events.push('typebox')
					return value
				})
				.Encode(String)
			const guard = standard(() => {
				events.push('standard')
				return { value: {} }
			})
			const validator = Validator.create(t.Object({ value: coded }), {
				schemas: [guard],
				app: {
					'~config': {
						experimental: {
							validationPlan: enabled ? validationPlan : undefined
						}
					}
				}
			})!

			validator.From!({ value: 'ok' }, 'body')
			return events
		}

		expect(run(false)).toEqual(['standard', 'typebox'])
		expect(run(true)).toEqual(['typebox', 'standard'])
	})

	it('goldens the intentional closed-extra old/new contract change', () => {
		const closed = (properties: Record<string, any>) =>
			t.Object(properties, { additionalProperties: false })
		const route = closed({ route: t.Number() })
		const guard = closed({ guarded: t.String() })
		const value = { route: 1, guarded: 'yes', extra: true }
		const legacy = Validator.create(route, {
			schemas: [guard],
			app: { '~config': { experimental: { validationPlan: undefined } } }
		})!
		const next = Validator.create(route, candidate({ schemas: [guard] }))!

		expect(() => legacy.From!(value, 'body')).not.toThrow()
		expect(() => next.From!(value, 'body')).toThrow(ValidationError)
	})

	it('goldens the intentional first-error old/new contract change', () => {
		const route = t.Object({ route: t.Number() })
		const guard = standard((value) => ({ value }))
		const value = { route: 'x' }
		const legacy = Validator.create(route, {
			schemas: [guard],
			app: { '~config': { experimental: { validationPlan: undefined } } }
		})!
		const next = Validator.create(route, candidate({ schemas: [guard] }))!
		const schemaPath = (validator: Validator) => {
			try {
				validator.From!(value, 'body')
			} catch (error) {
				return (error as ValidationError).errors[0]?.schemaPath
			}
		}

		expect(schemaPath(legacy)).toBe('#/allOf/0/properties/route')
		expect(schemaPath(next)).toBe('#/properties/route')
	})

	it('pins sanitizer order to one pass per declared member', () => {
		const events: string[] = []
		const validator = Validator.create(
			t.Object({ value: t.String() }),
			candidate({
				schemas: [t.Object({ value: t.String() })],
				sanitize(value) {
					if (typeof value !== 'string') return value
					events.push(value)
					return `${value}!`
				}
			})
		)!

		expect(validator.From!({ value: 'x' }, 'body')).toEqual({ value: 'x!' })
		expect(events).toEqual(['x', 'x'])
	})

	it('awaits a structural thenable and does not replay completed members', async () => {
		const events: string[] = []
		const thenable = standard((value) => {
			events.push('thenable')
			return {
				then(resolve: (value: unknown) => void) {
					resolve({ value: { async: value.id } })
				}
			}
		})
		const last = standard(() => {
			events.push('last')
			return { value: { last: true } }
		})

		const validator = Validator.create(
			thenable,
			candidate({ schemas: [last] })
		)!
		expect(validator.isAsync).toBe(false)
		await expect(validator.From!({ id: 7 }, 'body', true)).resolves.toEqual(
			{
				async: 7,
				last: true
			}
		)
		expect(events).toEqual(['thenable', 'last'])
	})

	it('stops at the first failure and preserves its error source', () => {
		let later = 0
		const failing = standard(() => ({
			issues: [{ message: 'guard failed', source: 'guard' }]
		}))
		const validator = Validator.create(
			failing,
			candidate({
				schemas: [
					standard(() => {
						later++
						return { value: {} }
					})
				]
			})
		)!

		let error: ValidationError | undefined
		try {
			validator.From!({}, 'body')
		} catch (cause) {
			error = cause as ValidationError
		}

		expect(error?.status).toBe(422)
		expect(error?.type).toBe('body')
		expect(error?.errors).toEqual([
			{ message: 'guard failed', source: 'guard' }
		])
		expect(later).toBe(0)
	})

	it('encodes every TypeBox codec before merging a response', () => {
		const encoded: string[] = []
		const coded = (name: string) =>
			t
				.Codec(t.String())
				.Decode((value) => Number(value))
				.Encode((value) => {
					encoded.push(name)
					return String(value)
				})
		const validator = Validator.create(
			t.Object({ a: coded('a') }),
			candidate({
				schemas: [t.Object({ b: coded('b') })]
			})
		)!

		expect(validator.EncodeFrom!({ a: 1, b: 2 }, 'response')).toEqual({
			a: '1',
			b: '2'
		})
		expect(encoded).toEqual(['a', 'b'])
		expect((validator as any).hasCodec).toBe(true)
	})

	it('preserves response status and awaits a mixed async member once', async () => {
		const events: string[] = []
		const coded = t
			.Codec(t.String())
			.Decode(Number)
			.Encode((value) => {
				events.push('encode')
				return String(value)
			})
		const response = Validator.response(
			{ 201: t.Object({ value: coded }) },
			candidate({
				schemas: [
					{
						201: standard(async () => {
							events.push('standard')
							return { value: { guarded: true } }
						})
					}
				]
			})
		)!

		expect(Object.keys(response)).toEqual(['201'])
		await expect(
			response[201].EncodeFrom!({ value: 2 }, 'response')
		).resolves.toEqual({ value: '2', guarded: true })
		expect(events).toEqual(['encode', 'standard'])
	})

	it('Check fails when a codec decode throws after its encoded check passes', () => {
		const throwing = t
			.Codec(t.String())
			.Decode(() => {
				throw new Error('decode failed')
			})
			.Encode(String)
		const validator = Validator.create(
			t.Object({ value: throwing }),
			candidate({
				schemas: [t.Object({ other: t.String() })]
			})
		)!

		expect(validator.Check({ value: 'encoded', other: 'ok' })).toBe(false)
	})

	it('leaves author-declared intersections as constraint conjunctions', () => {
		const validator = Validator.create(
			t.Intersect([
				t.Object({ a: t.Number() }),
				t.Object({ b: t.String() })
			])
		)!

		expect(validator.constructor.name).toBe('TypeBoxValidator')
		expect(validator.From!({ a: 1, b: 'ok' }, 'body')).toEqual({
			a: 1,
			b: 'ok'
		})
	})
})
