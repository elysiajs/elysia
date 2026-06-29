import type { ElysiaAdapterOptions } from './types'

export function createAdapter<const T extends ElysiaAdapterOptions>(
	adapter: ElysiaAdapterOptions
): T {
	return adapter as any
}

export type ElysiaAdapter = ReturnType<typeof createAdapter>

export type { ElysiaAdapterOptions } from './types'
