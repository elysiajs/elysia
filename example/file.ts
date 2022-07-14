import KingWorld from '../src'

new KingWorld()
    .get("/tako", () => Bun.file('./example/takodachi.png'))
    .listen(8080)
