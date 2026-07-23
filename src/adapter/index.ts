import type { ElysiaAdapterOptions } from './types'

// for type inference and following conventions like most frameworks
export const createAdapter = (adapter: ElysiaAdapterOptions) => adapter

export type ElysiaAdapter = ReturnType<typeof createAdapter>

export type { ElysiaAdapterOptions } from './types'
