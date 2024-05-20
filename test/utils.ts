import { it } from 'bun:test'
import { Elysia, ElysiaConfig } from '../src'

export const req = (path: string, options?: RequestInit) =>
	new Request(`http://localhost${path}`, options)

type MaybeArray<T> = T | T[]

export const upload = (
	path: string,
	fields: Record<
		string,
		MaybeArray<
			(string & {}) | 'aris-yuzu.jpg' | 'midori.png' | 'millenium.jpg'
		>
	>
) => {
	const body = new FormData()
	let size = 0

	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value))
			value.forEach((value) => {
				const file = Bun.file(`./test/images/${value}`)
				size += file.size
				body.append(key, file)
			})
		else if (value.includes('.')) {
			const file = Bun.file(`./test/images/${value}`)
			size += file.size
			body.append(key, file)
		} else body.append(key, value)
	}

	return {
		request: new Request(`http://localhost${path}`, {
			method: 'POST',
			body
		}),
		size
	}
}

export const post = (path: string, body: Record<string, any>) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	})

export const delay = (delay: number) =>
	new Promise((resolve) => setTimeout(resolve, delay))

export const namedElysiaIt = (
	fn: (this: Elysia) => void | Promise<void>,
	config?: ElysiaConfig<'', false>
) => {
	it(fn.name.split('_').join(' '), fn.bind(new Elysia(config)))
}
