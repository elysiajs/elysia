export const req = (path: string, options?: RequestInit) =>
	new Request(`http://localhost${path}`, options)

type MaybeArray<T> = T | T[]

export const upload = (
	path: string,
	fields: Record<
		string,
		MaybeArray<
			| (string & {})
			| 'aris-yuzu.jpg'
			| 'midori.png'
			| 'millenium.jpg'
			| 'fake.jpg'
			| 'kozeki-ui.webp'
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

export const post = (path: string, body?: string | Record<string, any>) =>
	typeof body === 'string'
		? new Request(`http://localhost${path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'text/plain',
					'Content-Length': String(Buffer.byteLength(body))
				},
				body
			})
		: new Request(`http://localhost${path}`, {
				method: 'POST',
				headers: body
					? {
							'Content-Type': 'application/json',
							'Content-Length': String(
								Buffer.byteLength(JSON.stringify(body))
							)
						}
					: {},
				body: body ? JSON.stringify(body) : body
			})

export const json = (body: Record<string, any> | any[]): RequestInit => ({
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'Content-Length': String(Buffer.byteLength(JSON.stringify(body)))
	},
	body: JSON.stringify(body)
})

export const delay = (delay: number) =>
	new Promise((resolve) => setTimeout(resolve, delay))

/**
 * How many times validating `value` reaches the global `JSON.parse`.
 * Synchronous validators only: `finally` restores `JSON.parse` before an async
 * validator would settle, so its parses go uncounted.
 */
export function parseCount(validator: any, value: unknown) {
	const original = JSON.parse
	let calls = 0

	JSON.parse = ((...args: Parameters<typeof original>) => {
		calls++

		return original(...args)
	}) as typeof original

	try {
		validator.From(value)
	} catch {
		// several callers expect rejection; only the parse count matters here
	} finally {
		JSON.parse = original
	}

	return calls
}
