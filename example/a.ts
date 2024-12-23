import { Elysia, file, t } from '../src'
import { req } from '../test/utils'

new Elysia().get('/', () => file('test/kyuukurarin.mp4')).listen(3000)
