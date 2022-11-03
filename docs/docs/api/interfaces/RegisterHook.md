# Interface: RegisterHook<Route, Instance\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](TypedRoute.md) = [`TypedRoute`](TypedRoute.md) |
| `Instance` | extends [`KingWorldInstance`](KingWorldInstance.md) = [`KingWorldInstance`](KingWorldInstance.md) |

## Table of contents

### Properties

- [afterHandle](RegisterHook.md#afterhandle)
- [beforeHandle](RegisterHook.md#beforehandle)
- [error](RegisterHook.md#error)
- [transform](RegisterHook.md#transform)

## Properties

### afterHandle

• **afterHandle**: `WithArray`<`AfterRequestHandler`<`Route`, `Instance`\>\>

#### Defined in

[src/types.ts:97](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L97)

___

### beforeHandle

• `Optional` **beforeHandle**: `WithArray`<[`Handler`](../modules.md#handler)<`Route`, `Instance`\>\>

#### Defined in

[src/types.ts:96](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L96)

___

### error

• `Optional` **error**: [`ErrorHandler`](../modules.md#errorhandler)

#### Defined in

[src/types.ts:98](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L98)

___

### transform

• `Optional` **transform**: `WithArray`<[`Handler`](../modules.md#handler)<`Route`, `Instance`\>\>

#### Defined in

[src/types.ts:95](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L95)
