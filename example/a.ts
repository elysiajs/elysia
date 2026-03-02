import { Elysia } from '../src'

new Elysia().get('/', 'Hi').listen(3000)
