import type { ElysiaAdapterOptions } from './types'

export const createAdapter = <const T extends ElysiaAdapterOptions>(
	adapter: T
) => adapter

export type ElysiaAdapter = ReturnType<typeof createAdapter>

export type { ElysiaAdapterOptions } from './types'
