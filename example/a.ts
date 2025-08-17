import { Elysia, t } from '../src'

const parserPlugin = new Elysia().onParse({ as: 'scoped' }, () => {})
const deletePlugin = new Elysia().delete('/delete', () => ({
	message: 'Resource deleted!'
}))

const app = new Elysia().use(parserPlugin).use(deletePlugin).listen(3000)

console.log(app.routes[0].compile().toString())
