import { Elysia } from '../src'
import { req } from '../test/utils';

export const app = new Elysia()
  .derive({ as: "scoped" }, async () => {
    return { myProp: 42 };
  })
  .macro(({ onBeforeHandle }) => ({
    public: (_?: boolean) => {
      onBeforeHandle(ctx => {
        ctx.myProp; // myProp is number | undefined, but it is always undefined in runtime
      });
    },
  }));

app.handle(req('/'))
