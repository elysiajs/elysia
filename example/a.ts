import { Elysia } from '../src'
import { req } from '../test/utils'

new Elysia()
  .ws("/", {
    ping() {
      console.log("onping")
    },

    pong() {
      console.log("onpong")
    },

    async message(ws) {
      console.log("onmessage")
      console.log(ws.body)
    },
  })
  .listen(3005)

const ws = new WebSocket("ws://localhost:3005")

ws.addEventListener("open", () => {
  ws.ping()
  ws.send("df")
  ws.ping()
})
