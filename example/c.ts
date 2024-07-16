// ? client
import { Elysia } from '../src'
import { isMainThread } from 'bun'

console.log(isMainThread)

new Elysia().get('/', () => 'from worker').listen(3000)
