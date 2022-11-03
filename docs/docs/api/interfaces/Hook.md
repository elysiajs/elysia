# Interface: Hook<Instance\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `Instance` | extends [`KingWorldInstance`](KingWorldInstance.md) = [`KingWorldInstance`](KingWorldInstance.md) |

## Table of contents

### Properties

- [afterHandle](Hook.md#afterhandle)
- [beforeHandle](Hook.md#beforehandle)
- [error](Hook.md#error)
- [transform](Hook.md#transform)

## Properties

### afterHandle

• **afterHandle**: `AfterRequestHandler`<`any`, `Instance`\>[]

#### Defined in

[src/types.ts:87](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L87)

___

### beforeHandle

• **beforeHandle**: [`Handler`](../modules.md#handler)<`any`, `Instance`\>[]

#### Defined in

[src/types.ts:86](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L86)

___

### error

• **error**: [`ErrorHandler`](../modules.md#errorhandler)[]

#### Defined in

[src/types.ts:88](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L88)

___

### transform

• **transform**: [`Handler`](../modules.md#handler)<`any`, `Instance`\>[]

#### Defined in

[src/types.ts:85](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L85)
