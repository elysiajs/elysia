import { Elysia, t } from '../src'

const app = new Elysia().get('/:id', ({ params }) => params.id).listen(3000)

// app.handle('/1')
// 	.then((x) => x.text())
// 	.then(console.log)
