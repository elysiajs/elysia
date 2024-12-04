import { createServer } from 'http'

createServer((req, res) => {
	res.statusCode = 201
	res.
	res.writeHead(200, {
		'content-type': 'application/json'
	})
	res.end('a')
}).listen(3000)
