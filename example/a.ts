import { Elysia, t } from '../src'

new Elysia({ prefix: "/a" })
	.get(
    "/todo/:id",
    ({ params }) => {
        // O `params.id` aqui já é totalmente tipado!
      return {
        id: params.id,
      };
    }
  )
