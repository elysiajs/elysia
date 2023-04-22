import { Elysia, t } from '../src'

const app = new Elysia()
  .get('/game/', () => {
    return 'GET /game'
  })
  .post('/game/', () => {
    return 'POST /game'
  })
  .post('/game/join', () => {
    return 'POST /game/join'
  })
  .get('/game/:gameId', () => {
    return 'GET /game/:gameId'
  })
  .get('/game/:gameId/state', () => {
    return 'GET /game/:gameId/state'
  })
  .post('/game/:gameId', () => {
    return 'POST /game/:gameId'
  })
  .get('/users/:userId', () => { // <------- not working "NOT_FOUND"
    return 'GET /users/:userId'
  })
  .get('/users/:userId/games', () => {
    return 'GET /users/:userId/games'
  })
  .listen(4000, ({ hostname, port }) => {
    console.log(`Running at http://${hostname}:${port}`)
  })

app.handle(new Request('http://localhost:8080/users/2'))
	.then((x) => x.text())
	.then(console.log)
