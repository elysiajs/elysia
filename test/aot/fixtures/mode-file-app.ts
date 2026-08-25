import { Elysia, t } from 'elysia'

// The external isBlob refinement keeps a t.File body schema wired to TypeBox.
export const app = new Elysia().post(
	'/upload',
	{ body: t.Object({ file: t.File() }) },
	({ body }) => ({ received: true, name: body.file.name })
)
