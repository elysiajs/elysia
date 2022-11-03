# Interface: LifeCycle<Instance\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `Instance` | extends [`KingWorldInstance`](KingWorldInstance.md) = [`KingWorldInstance`](KingWorldInstance.md) |

## Table of contents

### Properties

- [afterHandle](LifeCycle.md#afterhandle)
- [beforeHandle](LifeCycle.md#beforehandle)
- [error](LifeCycle.md#error)
- [parse](LifeCycle.md#parse)
- [request](LifeCycle.md#request)
- [start](LifeCycle.md#start)
- [stop](LifeCycle.md#stop)
- [transform](LifeCycle.md#transform)

## Properties

### afterHandle

• **afterHandle**: `AfterRequestHandler`<`any`, `Instance`\>

#### Defined in

[src/types.ts:53](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L53)

___

### beforeHandle

• **beforeHandle**: [`Handler`](../modules.md#handler)<`any`, `Instance`\>

#### Defined in

[src/types.ts:52](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L52)

___

### error

• **error**: [`ErrorHandler`](../modules.md#errorhandler)

#### Defined in

[src/types.ts:54](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L54)

___

### parse

• **parse**: [`BodyParser`](../modules.md#bodyparser)

#### Defined in

[src/types.ts:50](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L50)

___

### request

• **request**: [`BeforeRequestHandler`](../modules.md#beforerequesthandler)<{}\>

#### Defined in

[src/types.ts:49](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L49)

___

### start

• **start**: `VoidLifeCycle`

#### Defined in

[src/types.ts:48](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L48)

___

### stop

• **stop**: `VoidLifeCycle`

#### Defined in

[src/types.ts:55](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L55)

___

### transform

• **transform**: [`Handler`](../modules.md#handler)<`any`, `Instance`\>

#### Defined in

[src/types.ts:51](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/types.ts#L51)
