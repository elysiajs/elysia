import type { CanonicalValue } from '../compile/app-plan'

export interface ValidatorSemanticProjection {
	readonly remove: readonly string[]
	readonly children: readonly (readonly [
		string,
		ValidatorSemanticProjection
	])[]
}

export interface ValidatorSemanticMemberSource {
	readonly validator: object
	readonly typebox: boolean
	readonly projection: ValidatorSemanticProjection | null
}

/** @internal immutable construction-time identity channel. */
export const VALIDATOR_SEMANTIC_SOURCE = Symbol('elysia.validator.semantics')

/** @internal exact effective member order for composed validators. */
export const VALIDATOR_SEMANTIC_MEMBERS = Symbol('elysia.validator.members')

export function attachValidatorSemanticSource(
	validator: object,
	semantics: CanonicalValue
) {
	const current = Object.getOwnPropertyDescriptor(
		validator,
		VALIDATOR_SEMANTIC_SOURCE
	)
	if (
		current &&
		'value' in current &&
		JSON.stringify(current.value) === JSON.stringify(semantics)
	)
		return
	if (current && !current.configurable)
		throw new Error(
			'[Elysia] Validator semantic source changed after sealing.'
		)

	Object.defineProperty(validator, VALIDATOR_SEMANTIC_SOURCE, {
		value: semantics,
		configurable: true
	})
}

export function readValidatorSemanticSource(
	validator: object
): CanonicalValue | undefined {
	return (validator as any)[VALIDATOR_SEMANTIC_SOURCE]
}
