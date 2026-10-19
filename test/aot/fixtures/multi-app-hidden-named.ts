import { Elysia } from '../../../src'

// `hidden` is named but not exported, so the build gives it no manifest
const hidden = new Elysia({ name: 'hidden' }).get('/h', () => 'h')

export const app = new Elysia({ name: 'app' }).get('/', () => 'ok')

export const serveHidden = () => hidden.handle('/h')
