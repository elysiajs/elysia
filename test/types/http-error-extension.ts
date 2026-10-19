/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, HTTPError } from '../../src'

import { expectTypeOf } from 'expect-type'

// `extension()` members ride the inferred problem document, so Eden sees
// what the runtime serves. Elysia's own members win: an extension can't
// re-type `type`, `code` or `status`, it may set `title`/`instance`, and its
// string `detail` stands in for a `detail` the error has none of

// RFC 9457 §3.2's own example
class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
	readonly detail = 'Your current balance is 30, but that costs 50'

	constructor(readonly balance: number) {
		super()
	}

	extension() {
		return { balance: this.balance, accounts: ['/account/12345'] }
	}
}

type OutOfCreditProblem = {
	type: 'OUT_OF_CREDIT'
	code: 'OUT_OF_CREDIT'
	title: string
	status: 402
	detail: 'Your current balance is 30, but that costs 50'
	instance?: string
	balance: number
	accounts: string[]
}

type Flat<T> = { [K in keyof T]: T[K] }

// Exactly the same type, not an equivalent intersection
type Identical<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false

// Returned by the handler or by a beforeHandle
{
	const app = new Elysia()
		.get('/handler', () => new OutOfCredit(30))
		.get(
			'/before',
			{
				beforeHandle() {
					if (Math.random() > 0.5) return new OutOfCredit(30)
				}
			},
			() => 'ok' as const
		)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<
		Flat<Routes['handler']['get']['response'][402]>
	>().toEqualTypeOf<OutOfCreditProblem>()
	expectTypeOf<
		Flat<Routes['before']['get']['response'][402]>
	>().toEqualTypeOf<OutOfCreditProblem>()
	expectTypeOf<
		Routes['before']['get']['response'][200]
	>().toEqualTypeOf<'ok'>()

	// one flat object, as an editor hover and Eden show it
	expectTypeOf<
		Identical<Routes['handler']['get']['response'][402], OutOfCreditProblem>
	>().toEqualTypeOf<true>()

	// no `extension()`, no extra members
	class Plain extends HTTPError.id('PLAIN', 404) {}

	const plain = new Elysia().get('/', () => new Plain())

	expectTypeOf<
		keyof (typeof plain)['~Routes']['get']['response'][404]
	>().toEqualTypeOf<
		'type' | 'code' | 'title' | 'status' | 'detail' | 'instance'
	>()
}

// Every self-described problem document is one flat object, with or
// without an `extension()`
{
	// a `detail` of its own, no extension
	class Detailed extends HTTPError.id('DETAILED', 409) {
		readonly detail = 'detailed'
	}

	// the message lane: no `detail`, no extension
	class Bare extends HTTPError.id('BARE', 404) {}

	// the message lane, its `detail` from the extension
	class InsufficientBalance extends HTTPError.id(
		'INSUFFICIENT_BALANCE',
		402
	) {
		extension() {
			return { detail: 'out of credit', balance: 0 }
		}
	}

	const app = new Elysia()
		.get('/detailed', () => new Detailed())
		.get('/bare', () => new Bare())
		.get('/balance', () => new InsufficientBalance())

	type Routes = (typeof app)['~Routes']

	expectTypeOf<
		Identical<
			Routes['detailed']['get']['response'][409],
			{
				title: string
				instance?: string
				type: 'DETAILED'
				detail: 'detailed'
				code: 'DETAILED'
				status: 409
			}
		>
	>().toEqualTypeOf<true>()
	expectTypeOf<
		Identical<
			Routes['bare']['get']['response'][404],
			{
				title: string
				instance?: string
				type: 'BARE'
				detail?: string
				code: 'BARE'
				status: 404
			}
		>
	>().toEqualTypeOf<true>()
	expectTypeOf<
		Identical<
			Routes['balance']['get']['response'][402],
			{
				title: string
				instance?: string
				type: 'INSUFFICIENT_BALANCE'
				detail: string
				code: 'INSUFFICIENT_BALANCE'
				balance: number
				status: 402
			}
		>
	>().toEqualTypeOf<true>()
}

// Elysia's members win, the RFC's optional ones may be set, and a string
// `detail` serves for an error with none of its own
{
	class Spoof extends HTTPError.id('SPOOF', 409) {
		extension() {
			return {
				type: 'https://evil.example/hijack' as const,
				code: 'HIJACK' as const,
				status: 200 as const,
				detail: 'spoofed' as const,
				title: 'Custom' as const,
				instance: '/account/12345/msgs/abc',
				extra: 1
			}
		}
	}

	const app = new Elysia().get('/', () => new Spoof())

	type Problem = (typeof app)['~Routes']['get']['response'][409]

	expectTypeOf<Flat<Problem>>().toEqualTypeOf<{
		type: 'SPOOF'
		code: 'SPOOF'
		title: 'Custom'
		status: 409
		detail: 'spoofed'
		instance: string
		extra: number
	}>()
}

// The error's own `detail` wins over its extension's, a `detail` that isn't
// a string stays the message, and an extension that may be absent can't
// promise one
{
	class Own extends HTTPError.id('OWN', 409) {
		readonly detail = 'own'

		extension() {
			return { detail: 'from extension' as const }
		}
	}

	class Unset extends HTTPError.id('UNSET', 409) {
		extension() {
			return { detail: 'from extension' as const }
		}
	}

	class MaybeOwn extends HTTPError.id('MAYBE_OWN', 409) {
		declare readonly detail?: 'own'

		extension() {
			return { detail: 'from extension' as const }
		}
	}

	class NotString extends HTTPError.id('NOT_STRING', 409) {
		extension() {
			return { detail: 42 }
		}
	}

	class Absent extends HTTPError.id('ABSENT', 409) {
		extension: (() => { detail: 'from extension' }) | undefined = undefined
	}

	const app = new Elysia()
		.get('/own', () => new Own())
		.get('/unset', () => new Unset())
		.get('/maybe-own', () => new MaybeOwn())
		.get('/not-string', () => new NotString())
		.get('/absent', () => new Absent())

	type Routes = (typeof app)['~Routes']

	expectTypeOf<
		Routes['own']['get']['response'][409]['detail']
	>().toEqualTypeOf<'own'>()
	expectTypeOf<
		Routes['unset']['get']['response'][409]['detail']
	>().toEqualTypeOf<'from extension'>()
	expectTypeOf<
		Routes['maybe-own']['get']['response'][409]['detail']
	>().toEqualTypeOf<'from extension'>()
	expectTypeOf<
		Identical<
			Routes['not-string']['get']['response'][409],
			{
				title: string
				instance?: string
				type: 'NOT_STRING'
				detail?: string
				code: 'NOT_STRING'
				status: 409
			}
		>
	>().toEqualTypeOf<true>()
	expectTypeOf<
		Identical<
			Routes['absent']['get']['response'][409],
			{
				title: string
				instance?: string
				type: 'ABSENT'
				detail?: string
				code: 'ABSENT'
				status: 409
			}
		>
	>().toEqualTypeOf<true>()
}

// Only what the runtime copies: an index signature adds no member and can't
// re-type Elysia's, a function or symbol member is never served (one that
// may be a function may be missing), and a `title` that may be nullish may
// be filled in
{
	class Wide extends HTTPError.id('WIDE', 402) {
		extension(): Record<string, number> {
			return { balance: 30 }
		}
	}

	class WideWith extends HTTPError.id('WIDE_WITH', 402) {
		extension(): { [key: string]: unknown; balance: number } {
			return { balance: 30 }
		}
	}

	const brand: unique symbol = Symbol('brand')

	class Behavior extends HTTPError.id('BEHAVIOR', 402) {
		extension() {
			return {
				balance: 30,
				title: null,
				[brand]: 'data',
				toJSON: () => ({}),
				then: (resolve: () => void) => resolve(),
				[Symbol.asyncIterator]: async function* () {}
			}
		}
	}

	class Mixed extends HTTPError.id('MIXED', 402) {
		extension(): { title: 7 | null; label: string | (() => string) } {
			return { title: 7, label: 'mixed' }
		}
	}

	// every member optional
	class MaybeTitled extends HTTPError.id('MAYBE_TITLED', 402) {
		extension(): { title?: 'Custom'; balance?: number } {
			return {}
		}
	}

	const app = new Elysia()
		.get('/wide', () => new Wide())
		.get('/wide-with', () => new WideWith())
		.get('/behavior', () => new Behavior())
		.get('/mixed', () => new Mixed())
		.get('/maybe-titled', () => new MaybeTitled())

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Flat<Routes['wide']['get']['response'][402]>>().toEqualTypeOf<{
		type: 'WIDE'
		code: 'WIDE'
		title: string
		status: 402
		detail?: string
		instance?: string
	}>()
	expectTypeOf<
		Flat<Routes['wide-with']['get']['response'][402]>
	>().toEqualTypeOf<{
		type: 'WIDE_WITH'
		code: 'WIDE_WITH'
		title: string
		status: 402
		detail?: string
		instance?: string
		balance: number
	}>()
	expectTypeOf<
		Flat<Routes['behavior']['get']['response'][402]>
	>().toEqualTypeOf<{
		type: 'BEHAVIOR'
		code: 'BEHAVIOR'
		title: string
		status: 402
		detail?: string
		instance?: string
		balance: number
	}>()
	expectTypeOf<
		Flat<Routes['mixed']['get']['response'][402]>
	>().toEqualTypeOf<{
		type: 'MIXED'
		code: 'MIXED'
		title: 7 | string
		status: 402
		detail?: string
		instance?: string
		label?: string
	}>()
	expectTypeOf<
		Flat<Routes['maybe-titled']['get']['response'][402]>
	>().toEqualTypeOf<{
		type: 'MAYBE_TITLED'
		code: 'MAYBE_TITLED'
		title: string
		status: 402
		detail?: string
		instance?: string
		balance?: number
	}>()
}

// One document per member of a union return. An `extension` that may be
// absent may add nothing: its members are optional, its `title` may be the
// status title
{
	class Either extends HTTPError.id('EITHER', 402) {
		extension():
			| { kind: 'balance'; balance: number }
			| { kind: 'accounts'; accounts: string[] } {
			return { kind: 'balance', balance: 30 }
		}
	}

	class Optional extends HTTPError.id('OPTIONAL', 402) {
		extension?() {
			return { balance: 30 }
		}
	}

	class Assigned extends HTTPError.id('ASSIGNED', 402) {
		extension: (() => { balance: number; title: 'Custom' }) | undefined =
			undefined
	}

	const app = new Elysia()
		.get('/either', () => new Either())
		.get('/optional', () => new Optional())
		.get('/assigned', () => new Assigned())

	type Routes = (typeof app)['~Routes']
	type Either402 = Routes['either']['get']['response'][402]

	expectTypeOf<
		Extract<Either402, { kind: 'balance' }>['balance']
	>().toEqualTypeOf<number>()
	expectTypeOf<
		Extract<Either402, { kind: 'accounts' }>['accounts']
	>().toEqualTypeOf<string[]>()
	expectTypeOf<
		Flat<Routes['optional']['get']['response'][402]>
	>().toEqualTypeOf<{
		type: 'OPTIONAL'
		code: 'OPTIONAL'
		title: string
		status: 402
		detail?: string
		instance?: string
		balance?: number
	}>()
	expectTypeOf<
		Flat<Routes['assigned']['get']['response'][402]>
	>().toEqualTypeOf<{
		type: 'ASSIGNED'
		code: 'ASSIGNED'
		title: string
		status: 402
		detail?: string
		instance?: string
		balance?: number
	}>()
}

// `value()` replaces the document: its members ride only the fall-through
{
	class Answers extends HTTPError.id('ANSWERS', 402) {
		value() {
			return { whole: true as const }
		}

		extension() {
			return { member: 1 }
		}
	}

	class Declines extends HTTPError.id('DECLINES', 402) {
		value() {
			return Math.random() > 0.5 ? { whole: true as const } : undefined
		}

		extension() {
			return { member: 1 }
		}
	}

	const app = new Elysia()
		.get('/answers', () => new Answers())
		.get('/declines', () => new Declines())

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['answers']['get']['response'][402]>().toEqualTypeOf<{
		whole: true
	}>()
	expectTypeOf<
		Extract<
			Routes['declines']['get']['response'][402],
			{ status: 402 }
		>['member']
	>().toEqualTypeOf<number>()
}

// Sync, and a method: neither an async extension nor a data member is one
{
	class Async extends HTTPError.id('ASYNC', 400) {
		// @ts-expect-error a Promise is never awaited
		async extension() {
			return { member: 1 }
		}
	}

	class Data extends HTTPError.id('DATA', 400) {
		// @ts-expect-error a method, not a property
		readonly extension = { member: 1 }
	}
}
