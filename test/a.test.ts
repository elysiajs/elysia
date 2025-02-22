import { Elysia } from "../src";
import { it, expect } from "bun:test";

const asyncPlugin = Promise.resolve(new Elysia({ name: "AsyncPlugin" }));

const plugin = new Elysia({ name: "Plugin" })
  .use(asyncPlugin)
  .get("/plugin", () => "GET /plugin");

const app = new Elysia({ name: "App" })
  .use(plugin)
  .get("/foo", () => "GET /foo")

it("matches the right route", async () => {
  const response = await app.handle(new Request("http://localhost/plugin"));
  const text = await response.text();
  expect(text).toEqual("GET /plugin");
});
