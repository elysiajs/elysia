import { Elysia, file } from '../src'

export const app = new Elysia().get('/', () => file('a.txt')).listen(3000)
