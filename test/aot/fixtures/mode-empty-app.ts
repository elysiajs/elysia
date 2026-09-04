import { Elysia } from 'elysia'

// A routeless app has no captured handler evidence and therefore cannot seal.
export const app = new Elysia()
