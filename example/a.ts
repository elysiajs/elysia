import { Elysia } from '../src'

const app = new Elysia().get('/', () => 'hello' as any)

console.log("A")
app.listen(3000)
console.log("B")
