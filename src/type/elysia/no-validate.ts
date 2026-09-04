import type { TSchema } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { elyType } from './utils'

export const NoValidate = <T extends TSchema>(v: T, enabled = true) =>
	enabled ? elyType(ELYSIA_TYPES.NoValidate, v) : v
