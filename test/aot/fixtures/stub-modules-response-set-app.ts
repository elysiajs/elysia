import { Elysia, t } from '../../../src'

// The handler writes `set.cookie` without reading `cookie`: no jar alias,
// but the serializer runs on its response
export const app = new Elysia().get(
	'/',
	{ response: t.String({ minLength: 1 }) },
	({ set }) => {
		set.cookie = { seen: { value: '1' } }
		return 'ok'
	}
)
