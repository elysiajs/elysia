import { Elysia } from '../src'

const app = new Elysia({
	serve: {
		// can be string, BunFile, TypedArray, Buffer, or array thereof
		key: Bun.file('./key.pem'),
		cert: Bun.file('./cert.pem'),
		// passphrase, only required if key is encrypted
		passphrase: 'super-secret'
	}
}).listen(3000)
