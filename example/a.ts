import { Elysia, t, type ElysiaConfig } from '../src'

async function handler() {
  return new Response(
    JSON.stringify({ text: "hello" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

new Elysia()
  .get(
    "/hello",
    () => handler(),
    { response: { 200: t.Object({ text: t.String() }) } }
  )
  .listen(3000);
