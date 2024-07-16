import { Elysia, t } from '../src'

const subPlugin = new Elysia()
	.guard({
		as: 'global',
		response: {
			401: t.Literal('uma'),
			403: t.Literal(':('),
		}
	})

const plugin = new Elysia()
	.use(subPlugin)
	.guard({
		response: { 401: t.Number() }
	})
	.guard({
		as: 'global',
		response: { 418: t.Literal("I'm a teapot") }
	})
	.get('/', ({ error }) => error(401, 'uma'))
	.get('/', ({ error }) => error(401, 1))
	.get('/', ({ error }) => error(418, 'I\'m a teapot'))

const app = new Elysia()
	.use(plugin)
	.get('/', ({ error }) => error(401, 'uma'))
	.get('/', ({ error }) => error(418, 'I\'m a teapot'))
