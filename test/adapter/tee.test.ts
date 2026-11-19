import { describe, expect, it } from 'bun:test'

import { tee } from '../../src/adapter/utils'

describe('tee', () => {
	it('waits for every branch before pulling another value', async () => {
		let produced = 0

		async function* source() {
			for (let i = 0; i < 50; i++) {
				produced++
				yield i
			}
		}

		const [response, trace, afterResponse] = await tee(source(), 3)

		expect(await response.next()).toEqual({ done: false, value: 0 })

		const next = response.next()
		await Bun.sleep(10)
		expect(produced).toBe(1)

		expect(await trace.next()).toEqual({ done: false, value: 0 })
		expect(await afterResponse.next()).toEqual({ done: false, value: 0 })
		expect(await next).toEqual({ done: false, value: 1 })
		expect(produced).toBe(2)

		await Promise.all([
			response.return?.(),
			trace.return?.(),
			afterResponse.return?.()
		])
	})

	it('delivers every value to all three branches', async () => {
		async function* source() {
			yield 'a'
			yield 'b'
			yield 'c'
		}

		const collect = async (iterator: AsyncIterableIterator<string>) => {
			const values: string[] = []
			for await (const value of iterator) values.push(value)

			return values
		}

		const result = await Promise.all((await tee(source(), 3)).map(collect))

		expect(result).toEqual([
			['a', 'b', 'c'],
			['a', 'b', 'c'],
			['a', 'b', 'c']
		])
	})

	it('releases a pending value when a branch cancels', async () => {
		async function* source() {
			yield 1
			yield 2
		}

		const [response, trace, afterResponse] = await tee(source(), 3)

		expect(await response.next()).toEqual({ done: false, value: 1 })
		const next = response.next()

		await trace.return?.()
		expect(await afterResponse.next()).toEqual({ done: false, value: 1 })
		expect(await next).toEqual({ done: false, value: 2 })

		await response.return?.()
		await afterResponse.return?.()
	})

	it('returns the source after every branch cancels', async () => {
		let returned = 0
		const source = {
			[Symbol.asyncIterator]() {
				return {
					next: async () => ({
						done: false as const,
						value: 'value'
					}),
					return: async () => {
						returned++
						return { done: true as const, value: undefined }
					}
				}
			}
		}

		const [response, first, second] = await tee(source, 3)

		await first.return?.()
		await second.return?.()
		expect(returned).toBe(0)

		await response.return?.()
		expect(returned).toBe(1)
	})

	it('ends observer branches when the response branch cancels', async () => {
		let release!: () => void
		async function* source() {
			yield 'first'
			await new Promise<void>((resolve) => {
				release = resolve
			})
			yield 'second'
		}

		const [response, observer] = await tee(source(), 2)
		expect(await Promise.all([response.next(), observer.next()])).toEqual([
			{ done: false, value: 'first' },
			{ done: false, value: 'first' }
		])

		const observing = observer.next()
		await Promise.resolve()
		await response.return?.()

		expect(await observing).toEqual({ done: true, value: undefined })
		release()
	})

	it('propagates a source error to every branch', async () => {
		const failure = new Error('source failed')
		async function* source() {
			yield 'value'
			throw failure
		}

		const branches = await tee(source(), 3)
		expect(
			await Promise.all(branches.map((branch) => branch.next()))
		).toEqual([
			{ done: false, value: 'value' },
			{ done: false, value: 'value' },
			{ done: false, value: 'value' }
		])

		const errors = await Promise.all(
			branches.map(async (branch) => {
				try {
					await branch.next()
				} catch (error) {
					return error
				}
			})
		)

		expect(errors).toEqual([failure, failure, failure])
		expect(
			await Promise.all(branches.map((branch) => branch.next()))
		).toEqual([
			{ done: true, value: undefined },
			{ done: true, value: undefined },
			{ done: true, value: undefined }
		])
	})

	it('completes every branch when the source is empty', async () => {
		async function* source() {}

		const branches = await tee(source(), 3)

		expect(
			await Promise.all(branches.map((branch) => branch.next()))
		).toEqual([
			{ done: true, value: undefined },
			{ done: true, value: undefined },
			{ done: true, value: undefined }
		])
	})
})
