import { Elysia } from '../src'

export const lazy = async (app: Elysia) => app.get('/lazy', () => 'lazy')

export default lazy
