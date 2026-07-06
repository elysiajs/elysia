import { Elysia } from 'elysia'
import { z } from 'zod'

// Pure Standard Schema (Zod) app. Standard Schema slots never capture into the
// AOT manifest (`Validator.create` returns a `StandardValidator`, which never
// calls `captureImpl.maybeCapture`), yet they are inherently bridge-free — the
// runtime reconstructs a live `StandardValidator` without touching TypeBox.
// Every slot is bridge-free → the app must seal (TypeBox collapses).
export const app = new Elysia()
	.post(
		'/u',
		{ body: z.object({ name: z.string(), age: z.number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
