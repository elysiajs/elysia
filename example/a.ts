import { Elysia, t } from '../src'

const app = new Elysia()
	.group('/users', (app) =>
		app.get('/:userId', () => {
			return {}
		})
	)
	.group('/game', (app) =>
		app
			.get('/', () => {
				return 'GET /game'
			})
			.post('/', () => {
				return 'POST /game'
			})
			.post('/join', () => {
				return 'POST /game/join'
			})
			.get('/:gameId/state', () => {
				return 'GET /game/:gameId/state'
			})
			.get('/:gameId', () => {
				return 'GET /game/:gameId'
			})
			.post('/:gameId', () => {
				return 'POST /game/:gameId'
			})
	)
	.listen(4000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})

app.handle(new Request('http://localhost:8080/game/1/state'))
	.then((x) => x.text())
	.then(console.log)
