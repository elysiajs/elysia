import { Elysia, t } from '../src'

new Elysia()
	.model({
		'character.name': t.String(),
		'character.thing': t.Object({
			name: t.String()
		})
	})
	.get('/id/:id/name/:name', ({ params }) => {})
