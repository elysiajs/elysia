import { Elysia } from '../src'

const PATH = '/y a y'

const app = new Elysia({ precompile: true }).get('/y a y/:id', ({ params: { id } }) => id).compile()

app.router.http.build()
console.log(app.router.http)

const response = await app.handle(new Request(`http://localhost/y a y/1`))

console.log(response.status)
console.log(await response.text())

// expect(response.status).toBe(200)
// expect(await response.text()).toBe('1')
