import { Elysia } from '../src'

type MaybeArray<T> = T | T[]

const extension = new Elysia({ name: 'extension' }).extends(
	({ onBeforeHandle, events }) => ({
		beforeBeforeHandle(fn: MaybeArray<() => unknown>) {
			onBeforeHandle({ insert: 'before' }, fn)
		},
		afterBeforeHandle(fn: MaybeArray<() => unknown>) {
			onBeforeHandle({ insert: 'after' }, fn)
		}
	})
)

const app = new Elysia().use(extension).get('/', () => 'a', {
	beforeBeforeHandle: [
		() => console.log(1),
		() => console.log(2)
	],
	beforeHandle: () => console.log(3),
	afterBeforeHandle: () => console.log(4)
})

app.handle(new Request('http://localhost/'))
