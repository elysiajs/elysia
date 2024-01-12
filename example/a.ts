import { Elysia, t } from '../src'
import { parseCookie } from '../src/cookie'
import { req } from '../test/utils'

const app = new Elysia({ scoped: true, 'prefix': '/a' })
// .onTransform(({ set }) => {
// 	set.headers['x-powered-by'] = 'Elysia'
// })
// .get('/', () => 'Hi')

// const headers = await app.handle(req('/')).then((x) => x.headers.toJSON())

// console.log(headers)
// console.log(app.routes[0].composed?.toString())

interface RememberOption {
	path: string
	scoped: boolean
}

type Config<T extends RememberOption> = {
	name?: string
	path: T['path']
	scoped: T['scoped']
}

const a = <const A extends RememberOption>(_: Config<A>): A => {
	return '' as any
}

const b = a({ path: 'prefix', scoped: true })
