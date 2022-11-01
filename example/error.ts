import { brotliCompress, gzip } from 'zlib'
import KingWorld from '../src'

new KingWorld()
	.onError((error) => {
		if (error.code === 'NOT_FOUND')
			return new Response('Not Found :(', {
				status: 404
			})
	})
	.get('/', () => {
		throw new Error('A')
	})
	.listen(3000)
