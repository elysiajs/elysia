import { Elysia } from '../src'

export const lazy = async (app: Elysia) => app.get('/lazy', () => 'lazy')

export const lazyInstance = new Elysia().get('/lazy-instance', () => 'lazy-instance')

export default lazy
