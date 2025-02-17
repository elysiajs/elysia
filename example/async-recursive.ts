import { Elysia } from '../src'
import { req } from '../test/utils'

const yay = async () => {
	await Bun.sleep(2)

	return new Elysia({ name: 'yay' }).get('/yay', 'yay')
}

const yay2 = async () => {
	await Bun.sleep(2)

	return new Elysia({ name: 'yay2' }).use(yay)
}

const yay3 = async () => {
	await Bun.sleep(2)

	return new Elysia({ name: 'yay3' }).use(yay2)
}

const wrapper = new Elysia({ name: 'wrapper' }).use(async (app) => {
	return app.use(yay3)
})

const app = new Elysia({ name: 'main' }).use(wrapper)

await app.modules

const response = await app.handle(req('/yay'))

console.log(await response.text())
