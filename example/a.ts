import Elysia, { t } from '../src'

import Elysia, { t, type Static } from 'elysia'
export const editableFieldTypesValues = [
	'string',
	'number',
	'boolean',
	'select',
	'multiselect',
	'objectList',
	'object',
	'color'
] as const
export const FieldConfigurationParentType = {
	node: 'node',
	field: 'field'
} as const
export type FieldConfigurationParentType =
	(typeof FieldConfigurationParentType)[keyof typeof FieldConfigurationParentType]
export const FieldClassTokens = {
	Static: 'static',
	Enum: 'enum',
	Complex: 'complex'
} as const
export type FieldClassTokens =
	(typeof FieldClassTokens)[keyof typeof FieldClassTokens]
export type NonEmptyArray<T> = [T, ...T[]]
export const FieldConfigurationTypeSchema = t.Recursive((_this) =>
	t.Object({
		field_id: t.Number(),
		parent_id: t.String(),
		parent_type: t.UnionEnum(
			Object.values(
				FieldConfigurationParentType
			) as NonEmptyArray<FieldConfigurationParentType>
		),
		field_type: t.UnionEnum(editableFieldTypesValues),
		field_name: t.String(),
		field_display_name: t.String(),
		field_class: t.UnionEnum(
			Object.values(FieldClassTokens) as NonEmptyArray<FieldClassTokens>
		),
		subFields: t.Optional(t.Array(_this))
	})
)

const app = new Elysia()
	.get(
		'/buggedRoute',
		() => {
			return [
				{
					field_class: 'static' as const,
					field_display_name: '',
					field_id: 0,
					field_name: '',
					field_type: 'string' as const,
					parent_id: '',
					parent_type: 'node' as const,
					subFields: [
						{
							field_class: 'static' as const,
							field_display_name: '',
							field_id: 1,
							field_name: '',
							field_type: 'string' as const,
							parent_id: '',
							parent_type: 'field' as const
						}
					]
				}
			]
		},
		{ response: { 200: t.Array(FieldConfigurationTypeSchema) } }
	)
	.listen(3000, () => console.log('running'))
