import { Elysia, t } from '../src'
import html from '../example/index.html'

const app = new Elysia().get('/', html).listen(3000)
