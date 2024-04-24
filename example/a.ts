import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const body = {
	name: 'Rikuhachima Aru'
}

const app = new Elysia().post('/json', ({ body: { name } }) => name, {
	type: 'json',
	body: t.Object({
		name: t.String()
	}),
	parse({}, type) {
		if (type === 'custom') return { name: 'Mutsuki' }
	}
})

const res = await app.handle(post('/json', body)).then((x) => x.text())

// console.log(res)
