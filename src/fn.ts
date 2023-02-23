import { EXPOSED } from './utils'

import type { Context } from './context'
import type {
	ConnectedKeysType,
	ElysiaInstance,
	FunctionProperties,
	JoinKeys
} from './types'

import { serialize as superjsonSerialize } from 'superjson'

export const permission = <
	T,
	Key extends JoinKeys<FunctionProperties<T>> = JoinKeys<
		FunctionProperties<T>
	>
>({
	value,
	allow,
	deny,
	check = true
}: {
	value: T
	allow?: Key[]
	deny?: Key[]
	check?:
		| boolean
		| ((context: {
				request: Request
				key: Key
				params: T extends (...args: infer Args) => any
					? Args
					: Key extends string
					? ConnectedKeysType<T, Key>
					: unknown
				match: <Case extends Key>(
					a: Case extends string
						? Partial<
								| {
										[x in Case]: (
											params: ConnectedKeysType<T, Case>
										) => any
								  }
								| {
										default?: (
											params: T extends (
												...args: infer Args
											) => any
												? Args
												: Key extends string
												? ConnectedKeysType<T, Key>
												: unknown
										) => any
								  }
						  >
						: {}
				) => void
		  }) => unknown)
}) => ({
	[EXPOSED]: true,
	value,
	check,
	allow,
	deny
})

export type Permission = typeof permission

export const runFn = (
	context: Context,
	exposed: ElysiaInstance['meta'][typeof EXPOSED]
): Promise<Record<string, any>> => {
	const results = []

	const body = context.body as {
		n: string[]
		p: any[] | undefined
	}[]

	batch: for (let i = 0; i < body.length; i++) {
		const procedure = body[i]
		let method: Record<string, any> = exposed

		const names = procedure.n

		if (!Array.isArray(procedure.n)) {
			results.push(new Error('Invalid procedure'))
			continue batch
		}

		let caller = names[names.length - 1]

		if (names.length === 1) {
			if (caller in method && EXPOSED in method[caller])
				if (method[caller].check == false) {
					results.push(new Error('Forbidden'))
					continue batch
				} else if (method[caller].check !== true) {
					try {
						const allowance: Permission = method[
							caller
						].check({
							...context,
							key: caller,
							params: procedure.p ?? null,
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							match(_: {}) {
								// Emtpy
							}
						})

						if (allowance instanceof Error) {
							results.push(allowance)
							continue batch
						}
					} catch (error) {
						results.push(error)
						continue batch
					}

					method = method[caller]
					caller = 'value'
				}
		} else
			for (let j = 0; j < names.length - 1; j++) {
				// @ts-ignore
				method = method[names[j]]

				if (!method) {
					results.push(new Error('Invalid procedure'))
					continue batch
				}

				if (EXPOSED in method) {
					const key = names.slice(j + 1).join('.')
					const hasCheckFn = typeof method.check === 'function'

					if (method.allow?.includes(key) === true && !hasCheckFn) {
						method = method.value
						continue
					}

					if (
						method.check == false ||
						method.deny?.includes(key) === true ||
						(method.allow?.includes(key) === false &&
							!method.deny &&
							!hasCheckFn)
					) {
						results.push(new Error('Forbidden'))
						continue batch
					} else if (method.check !== true)
						try {
							let cases:
								| Record<
										string,
										(params: unknown[] | null) => unknown
								  >
								| undefined

							const allowance = method.check({
								...context,
								key,
								params: procedure.p ?? null,
								match(
									innerCases: Record<
										string,
										(params: unknown[] | null) => unknown
									>
								) {
									cases = innerCases
								}
							})

							if (cases) {
								try {
									const response = (
										cases[key] ?? cases.default
									)?.(procedure.p ?? null)

									if (response instanceof Error)
										throw response
								} catch (error) {
									if (
										!(key in cases) &&
										method.allow?.includes(key)
									) {
										method = method.value
										continue
									}

									results.push(error)
									continue batch
								}
							}

							if (allowance instanceof Error) {
								results.push(allowance)
								continue batch
							}
						} catch (error) {
							results.push(error)
							continue batch
						}

					method = method.value
				}
			}

		// ? Need to call Class.method to access this
		if (typeof method[caller] !== 'function')
			results.push(new Error('Invalid procedure'))
		else if (procedure.p === undefined) results.push(method[caller]())
		else if (procedure.p.length === 1)
			results.push(method[caller](procedure.p[0]))
		else results.push(method[caller](...procedure.p))
	}

	return Promise.all(results).then(superjsonSerialize)
}
