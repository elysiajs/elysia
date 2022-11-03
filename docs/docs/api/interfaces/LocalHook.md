# Interface: LocalHook<Schema, Instance\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](TypedSchema.md) |
| `Instance` | extends [`KingWorldInstance`](KingWorldInstance.md) = [`KingWorldInstance`](KingWorldInstance.md) |

## Table of contents

### Properties

- [afterHandle](LocalHook.md#afterhandle)
- [beforeHandle](LocalHook.md#beforehandle)
- [schema](LocalHook.md#schema)
- [transform](LocalHook.md#transform)

## Properties

### afterHandle

• `Optional` **afterHandle**: `WithArray`<`HookHandler`<`Schema`, `Instance`\>\>

#### Defined in

[src/types.ts:161](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L161)

___

### beforeHandle

• `Optional` **beforeHandle**: `WithArray`<`HookHandler`<`Schema`, `Instance`\>\>

#### Defined in

[src/types.ts:160](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L160)

___

### schema

• `Optional` **schema**: `Schema`

#### Defined in

[src/types.ts:158](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L158)

___

### transform

• `Optional` **transform**: `WithArray`<`HookHandler`<`Schema`, `Instance`\>\>

#### Defined in

[src/types.ts:159](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L159)
