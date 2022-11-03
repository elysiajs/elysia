# kingworld

## Table of contents

### Classes

- [Context](classes/Context.md)
- [default](classes/default.md)

### Interfaces

- [Hook](interfaces/Hook.md)
- [InternalRoute](interfaces/InternalRoute.md)
- [KingWorldConfig](interfaces/KingWorldConfig.md)
- [KingWorldInstance](interfaces/KingWorldInstance.md)
- [LifeCycle](interfaces/LifeCycle.md)
- [LocalHook](interfaces/LocalHook.md)
- [RegisterHook](interfaces/RegisterHook.md)
- [TypedRoute](interfaces/TypedRoute.md)
- [TypedSchema](interfaces/TypedSchema.md)

### Type Aliases

- [BeforeRequestHandler](modules.md#beforerequesthandler)
- [BodyParser](modules.md#bodyparser)
- [ComposedHandler](modules.md#composedhandler)
- [ErrorCode](modules.md#errorcode)
- [ErrorHandler](modules.md#errorhandler)
- [HTTPMethod](modules.md#httpmethod)
- [Handler](modules.md#handler)
- [KWKey](modules.md#kwkey)
- [LifeCycleEvent](modules.md#lifecycleevent)
- [LocalHandler](modules.md#localhandler)

### Variables

- [SCHEMA](modules.md#schema)

## Type Aliases

### BeforeRequestHandler

Ƭ **BeforeRequestHandler**<`Store`\>: (`request`: `Request`, `store`: `Store`) => `Response` \| `Promise`<`Response`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Store` | extends `Record`<`string`, `any`\> = {} |

#### Type declaration

▸ (`request`, `store`): `Response` \| `Promise`<`Response`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `request` | `Request` |
| `store` | `Store` |

##### Returns

`Response` \| `Promise`<`Response`\>

#### Defined in

[src/types.ts:79](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L79)

___

### BodyParser

Ƭ **BodyParser**: (`request`: `Request`) => `any` \| `Promise`<`any`\>

#### Type declaration

▸ (`request`): `any` \| `Promise`<`any`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `request` | `Request` |

##### Returns

`any` \| `Promise`<`any`\>

#### Defined in

[src/types.ts:43](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L43)

___

### ComposedHandler

Ƭ **ComposedHandler**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `handle` | [`Handler`](modules.md#handler)<`any`, `any`\> |
| `hooks` | [`Hook`](interfaces/Hook.md)<`any`\> |
| `validator` | `SchemaValidator` |

#### Defined in

[src/types.ts:184](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L184)

___

### ErrorCode

Ƭ **ErrorCode**: ``"NOT_FOUND"`` \| ``"INTERNAL_SERVER_ERROR"`` \| ``"BODY_LIMIT"`` \| ``"UNKNOWN"``

#### Defined in

[src/types.ts:261](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L261)

___

### ErrorHandler

Ƭ **ErrorHandler**: (`errorCode`: `KingWorldError`) => `void` \| `Response`

#### Type declaration

▸ (`errorCode`): `void` \| `Response`

##### Parameters

| Name | Type |
| :------ | :------ |
| `errorCode` | `KingWorldError` |

##### Returns

`void` \| `Response`

#### Defined in

[src/types.ts:271](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L271)

___

### HTTPMethod

Ƭ **HTTPMethod**: ``"ACL"`` \| ``"BIND"`` \| ``"CHECKOUT"`` \| ``"CONNECT"`` \| ``"COPY"`` \| ``"DELETE"`` \| ``"GET"`` \| ``"HEAD"`` \| ``"LINK"`` \| ``"LOCK"`` \| ``"M-SEARCH"`` \| ``"MERGE"`` \| ``"MKACTIVITY"`` \| ``"MKCALENDAR"`` \| ``"MKCOL"`` \| ``"MOVE"`` \| ``"NOTIFY"`` \| ``"OPTIONS"`` \| ``"PATCH"`` \| ``"POST"`` \| ``"PROPFIND"`` \| ``"PROPPATCH"`` \| ``"PURGE"`` \| ``"PUT"`` \| ``"REBIND"`` \| ``"REPORT"`` \| ``"SEARCH"`` \| ``"SOURCE"`` \| ``"SUBSCRIBE"`` \| ``"TRACE"`` \| ``"UNBIND"`` \| ``"UNLINK"`` \| ``"UNLOCK"`` \| ``"UNSUBSCRIBE"``

#### Defined in

[src/types.ts:225](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L225)

___

### Handler

Ƭ **Handler**<`Route`, `Instance`\>: (`context`: [`Context`](classes/Context.md)<`Route`, `Instance`[``"store"``]\> & `Instance`[``"request"``]) => `Route`[``"response"``] \| `Promise`<`Route`[``"response"``]\> \| `Response`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](interfaces/TypedRoute.md) = [`TypedRoute`](interfaces/TypedRoute.md) |
| `Instance` | extends [`KingWorldInstance`](interfaces/KingWorldInstance.md) = [`KingWorldInstance`](interfaces/KingWorldInstance.md) |

#### Type declaration

▸ (`context`): `Route`[``"response"``] \| `Promise`<`Route`[``"response"``]\> \| `Response`

##### Parameters

| Name | Type |
| :------ | :------ |
| `context` | [`Context`](classes/Context.md)<`Route`, `Instance`[``"store"``]\> & `Instance`[``"request"``] |

##### Returns

`Route`[``"response"``] \| `Promise`<`Route`[``"response"``]\> \| `Response`

#### Defined in

[src/types.ts:24](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L24)

___

### KWKey

Ƭ **KWKey**: `string` \| `number` \| `symbol`

#### Defined in

[src/types.ts:8](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L8)

___

### LifeCycleEvent

Ƭ **LifeCycleEvent**: ``"start"`` \| ``"request"`` \| ``"parse"`` \| ``"transform"`` \| ``"beforeHandle"`` \| ``"afterHandle"`` \| ``"error"`` \| ``"stop"``

#### Defined in

[src/types.ts:31](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L31)

___

### LocalHandler

Ƭ **LocalHandler**<`Schema`, `Instance`, `Path`\>: [`Handler`](modules.md#handler)<`Schema`[``"params"``] extends `NonNullable`<`Schema`[``"params"``]\> ? `TypedSchemaToRoute`<`Schema`\> : `Omit`<`TypedSchemaToRoute`<`Schema`\>, ``"params"``\> & { `params`: `Record`<`ExtractKWPath`<`Path`\>, `string`\>  }, `Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](interfaces/TypedSchema.md) = [`TypedSchema`](interfaces/TypedSchema.md) |
| `Instance` | extends [`KingWorldInstance`](interfaces/KingWorldInstance.md) = [`KingWorldInstance`](interfaces/KingWorldInstance.md) |
| `Path` | extends `string` = `string` |

#### Defined in

[src/types.ts:164](https://github.com/gaurishhs/kingworld/blob/998f83a/src/types.ts#L164)

## Variables

### SCHEMA

• `Const` **SCHEMA**: unique `symbol`

#### Defined in

[src/utils.ts:8](https://github.com/gaurishhs/kingworld/blob/998f83a/src/utils.ts#L8)
