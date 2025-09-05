import { Elysia, fileType, file, form } from '../src'

const app = new Elysia().post('/', ({ body }) => 'a').listen(3000)

app['~Routes']['post']
