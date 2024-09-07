import { Elysia, t } from '../src'

const plugin = new Elysia().get('/plugin', 'static ')
