import { Elysia, t } from '../../../src'

// A declared schema is snapshotted at registration
export const app = new Elysia().post(
	'/',
	{ body: t.Object({ name: t.String() }) },
	({ body }) => body.name
)
