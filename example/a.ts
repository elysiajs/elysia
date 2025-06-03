import { Elysia, t } from '../src'

export const app = new Elysia().group(
	'/group',
	{},
	(
		a // <- With guard param
	) =>
		a.ws('/ws', {
			open: () => {},
			error: () => {},
			message: () => {}
		})
)
