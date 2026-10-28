/**
 * Named re-exports of the TypeBox value side Elysia uses, so bundlers can
 * tree-shake the rest when it is loaded through a literal `require`
 *
 * Side-effect free: it loads lazily, possibly after a user's `Settings.Set`
 */
export {
	Check,
	Clean,
	Clone,
	Create,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	EncodeUnsafe,
	Errors,
	HasCodec
} from 'typebox/value'
export { Build, Compile as SchemaCompile } from 'typebox/schema'
export { Compile } from 'typebox/compile'
