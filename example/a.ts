const t1 = performance.now()
import { Elysia, t } from '../src'

const app = new Elysia()

for (let i = 0; i < 100_000; i++) app.get(`/${i}`, () => 'hi')

app.listen(3000)

fetch('http://localhost:3000/99999').then(console.log)

const t2 = performance.now()
console.log(`Server started in ${t2 - t1}ms`)
