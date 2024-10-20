import { createServer } from 'node:http'

createServer((req, res) => {
	res.statusCode = 201
	res.writeHead(200, {
		'content-type': 'application/json'
	})
	res.end('a')
}).listen(3000)
