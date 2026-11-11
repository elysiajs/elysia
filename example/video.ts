import { Elysia } from '../src'

new Elysia().get('/', Bun.file('test/kyuukurarin.mp4')).listen(3000)
