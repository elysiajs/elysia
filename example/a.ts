import Elysia, { t } from '../src'

const strict = new Elysia({ strictPath: true })
	.get('', '')

console.log(strict.router.response)

// console.log(app.router.response)
