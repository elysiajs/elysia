import { InternalSymbolName } from 'typescript'
import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', () => 'ok').compile()
for (const route of app.routes) route.compile()

console.log(app.fetch.toString())
console.log(app.routes[0].compile().toString())

// Bun.sleepSync(7)
// console.log('Slept')

const res = app
	.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)

// process.exit(0)
