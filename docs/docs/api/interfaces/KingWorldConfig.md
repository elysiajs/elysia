# Interface: KingWorldConfig

## Table of contents

### Properties

- [ajv](KingWorldConfig.md#ajv)
- [bodyLimit](KingWorldConfig.md#bodylimit)
- [strictPath](KingWorldConfig.md#strictpath)

## Properties

### ajv

• **ajv**: `Ajv`

Custom ajv instance

#### Defined in

[src/types.ts:208](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L208)

___

### bodyLimit

• **bodyLimit**: `number`

Defines the maximum payload, in bytes, the server is allowed to accept.

**`Default`**

1048576 (1MB)

#### Defined in

[src/types.ts:196](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L196)

___

### strictPath

• **strictPath**: `boolean`

If set to `true`, path will **NOT** try to map trailing slash with none.

For example: `/group/` will not be map to `/group` or vice versa.

**`Default`**

false

#### Defined in

[src/types.ts:204](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L204)
