import { Elysia, t } from 'elysia'

// AOT fixture: app with a body schema containing t.File(). Prior design intent
// is that t.File() seals (the isBlob refine is an external but the bridge-free
// determination is made at capture time). This fixture lets the test observe the
// actual mode and pin it explicitly (see the plan's Step 4 rationale).
export const app = new Elysia().post(
	'/upload',
	{ body: t.Object({ file: t.File() }) },
	({ body }) => ({ received: true, name: body.file.name })
)
