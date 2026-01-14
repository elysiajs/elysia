import { Elysia } from '../src'

new Elysia()
.post(
    "/create-post",
    async (ctx) => {
      return {
        message: "Post Created",
        data: ctx.body,
      };
    },
    {
      body: t.Object({
        name: t.String(),
        content: t.String(),
        safeAge: t.Number(),
      }),
    },
