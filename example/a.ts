import { Elysia } from '../src'
import { manifest } from '../src/manifest'

const b = new Elysia().get('/b', () => 'Hello, World!')

const app = new Elysia().use(b).get('/', () => 'Hello, World!')

manifest(app)
