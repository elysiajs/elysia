import { Elysia } from '../src'
import { req } from '../test/utils'

const delay = <T extends (...args: any) => any>(
	callback: T,
	ms = 617
): Promise<ReturnType<T>> => Bun.sleep(ms).then(callback)

const yay = () => delay(() => new Elysia().use(import('./lazy')))
const yay2 = () => delay(() => new Elysia().use(yay), 5)
const yay3 = () => delay(() => new Elysia().use(yay2), 10)
const wrapper = new Elysia().use(async () => delay(() => yay3(), 6))

const app = new Elysia().use(wrapper)

await app.modules

// should works
app.handle(req('/lazy'))
	.then((x) => x.text())
	.then(console.log)
