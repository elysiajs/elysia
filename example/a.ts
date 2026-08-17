import { Elysia, t } from '../src'
import type { AnySchema, MacroTypeLambda, UnwrapSchema } from '../src'

interface ChannelLambda extends MacroTypeLambda {
	output: this['input'] extends { of: infer S extends AnySchema }
		? { custom: UnwrapSchema<S> }
		: { custom: unknown }
}

new Elysia()
	.macro({
		channel: (option: {
			of: AnySchema
		}): { $type?: ChannelLambda; derive(c: unknown): unknown } => ({
			derive: (context) => ({ channel: { entries: {}, of: option.of } })
		})
	})
	.get(
		'/stats',
		{ channel: { of: t.Object({ count: t.Number() }) } },
		({ custom }) => {



			custom.count
		}
	)
	.get(
		'/room',
		{ channel: { of: t.Object({ id: t.String(), name: t.String() }) } },
		({ custom }) => {
			// hover: Readonly<Record<string, { id: string; name: string }>>
			channel.entries

			const first = Object.values(channel.entries)[0]
			first?.name.toUpperCase()

			// @ts-expect-error no such field on the viewer schema
			first?.count

			return { viewers: Object.values(channel.entries) }
		}
	)
