import { Elysia, t } from '../src'

const app = new Elysia().post('/', ({ body: { file } }) => file, {
	body: t.Object({
		file: t.String()
	})
})
