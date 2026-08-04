# Error Handling

# Error Handling

## JSON Error Formatting

To return errors in JSON format, you can use the `formatErrorAsJSON` function in your `onError` callback. This function converts error objects to JSON format, making it easier to handle them on the client side. Here's an example of how to set it up:

```typescript
import { Elysia, t } from "elysia";
import { formatErrorAsJSON } from "../utils/errorFormatter.js";

const app = new Elysia()
  .post(
    "/sign-up",
    async ({ body }) =>
      db.user.create({
        data: body,
      }),
    {
      body: t.Object({
        username: t.String(),
        password: t.String({
          minLength: 8,
        }),
      }),
    }
  )
  .onError(({ code, error }) => {
    return formatErrorAsJSON(error);
  })
  .listen(3000);

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
```

Ensure that the `formatErrorAsJSON` function is imported and used in your `onError` callback as shown in the example above.

This setup ensures that all errors are returned in JSON format, making it easier to handle them on the client side. Ensure that the `formatErrorAsJSON` function is imported and used in your `onError` callback as shown in the example above.