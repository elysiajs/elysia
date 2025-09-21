import { Elysia, t } from '../src'

const app = new Elysia().get('/สวัสดี', 'สบายดีไหม').listen(0)

const response = await fetch(`http://localhost:${app.server!.port}/สวัสดี`)
const text = await response.text()

console.log(text)
