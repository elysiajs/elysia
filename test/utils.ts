export const req = (path: string) => new Request(`http://localhost${path}`)

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

	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value))
			value.forEach((value) => {
				body.append(key, Bun.file(`./test/images/${value}`))
			})
		else if (value.includes('.'))
			body.append(key, Bun.file(`./test/images/${value}`))
		else body.append(key, value)
	}

	console.log(body)

	return new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: {
			'content-type': 'multipart/form-data'
		},
		body
	})
}
