const handle = async (request: Request) => {
	const bodySize = request.headers.get('content-length')

	// ? For some reason, this prevent segmentation fault (Bun 0.1.10)
	const body = !bodySize
        ? undefined
        : request.headers.get('content-type') === 'application/json'
        ? await request.json()
        : await request.text()	

	const a = {
		body
	}

	return new Response('done')
}

const body = JSON.stringify({
	tako: 'dachi'
})

handle(
	new Request('http://localhost:3000/json', {
		method: 'POST',
		body,
		headers: {
			'content-type': 'application/json',
			'content-length': body.length.toString()
		}
	})
)

for (let i = 0; i < 10_000_000; i++)
	handle(
		new Request('http://localhost:3000/json', {
			method: 'POST',
			body,
			headers: {
				'content-type': 'application/json',
				'content-length': body.length.toString()
			}
		})
	)
