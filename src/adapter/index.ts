import type { AnyElysia } from '../base'
import type { ElysiaAdapterOptions } from './types'

// for type inference and following conventions like most frameworks
export const createAdapter = <App extends AnyElysia | void = void>(
	adapter: ElysiaAdapterOptions<App>
) => adapter

export type ElysiaAdapter = ReturnType<typeof createAdapter>

export type { ElysiaAdapterOptions } from './types'
