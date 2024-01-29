import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ aot: false }).post('/', (ctx) => ctx.body, {
    parse: (ctx, contentType) => {
      return contentType;
    },
    body: t.String()
  });

  const res = await app.handle(
    new Request('http://localhost', {
      method: 'POST',
      body: 'yay',
      headers: { 'content-type': 'text/plain' }
    })
  ).then(x => x.text())
