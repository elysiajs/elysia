import Elysia, { t } from "../src";

const api = new Elysia().get("", ({ query }) => query, {
  query: t.Object({
    array: t.Array(t.String()), // Mark as an array
    simple: t.String(), // Mark as not an array
  }),
});

console.log(api.routes[0].compile().toString())

const url = new URL("http://localhost/");
url.searchParams.append("array", "a+b");
url.searchParams.append("array", "c+d");
url.searchParams.append("simple", "e+f");
console.log(url.href); //http://localhost/?array=a%2Bb&array=c%2Bd&simple=e%2Bf  `+` encoded as `%2B`

const result = await api
  .handle(new Request(url.href))
  .then((response) => response.json());

console.log(result);
