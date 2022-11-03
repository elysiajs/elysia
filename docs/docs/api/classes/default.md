# Class: default<Instance\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `Instance` | extends [`KingWorldInstance`](../interfaces/KingWorldInstance.md) = [`KingWorldInstance`](../interfaces/KingWorldInstance.md) |

## Table of contents

### Constructors

- [constructor](default.md#constructor)

### Properties

- [config](default.md#config)
- [event](default.md#event)
- [router](default.md#router)
- [routes](default.md#routes)
- [server](default.md#server)
- [store](default.md#store)

### Methods

- [\_addHandler](default.md#_addhandler)
- [afterHandle](default.md#afterhandle)
- [connect](default.md#connect)
- [decorate](default.md#decorate)
- [delete](default.md#delete)
- [get](default.md#get)
- [getSchema](default.md#getschema)
- [getSchemaValidator](default.md#getschemavalidator)
- [group](default.md#group)
- [guard](default.md#guard)
- [handle](default.md#handle)
- [handleError](default.md#handleerror)
- [head](default.md#head)
- [listen](default.md#listen)
- [method](default.md#method)
- [on](default.md#on)
- [onBeforeHandle](default.md#onbeforehandle)
- [onError](default.md#onerror)
- [onParse](default.md#onparse)
- [onRequest](default.md#onrequest)
- [onStart](default.md#onstart)
- [onStop](default.md#onstop)
- [onTransform](default.md#ontransform)
- [options](default.md#options)
- [patch](default.md#patch)
- [post](default.md#post)
- [put](default.md#put)
- [state](default.md#state)
- [stop](default.md#stop)
- [trace](default.md#trace)
- [use](default.md#use)

## Constructors

### constructor

• **new default**<`Instance`\>(`config?`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Instance` | extends [`KingWorldInstance`](../interfaces/KingWorldInstance.md)<{ `request`: `Record`<[`KWKey`](../modules.md#kwkey), `any`\> ; `store`: `Record`<[`KWKey`](../modules.md#kwkey), `any`\>  }, `Instance`\> = [`KingWorldInstance`](../interfaces/KingWorldInstance.md)<{ `request`: `Record`<[`KWKey`](../modules.md#kwkey), `any`\> ; `store`: `Record`<[`KWKey`](../modules.md#kwkey), `any`\>  }\> |

#### Parameters

| Name | Type |
| :------ | :------ |
| `config` | `Partial`<[`KingWorldConfig`](../interfaces/KingWorldConfig.md)\> |

#### Defined in

[src/index.ts:73](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L73)

## Properties

### config

• `Private` **config**: [`KingWorldConfig`](../interfaces/KingWorldConfig.md)

#### Defined in

[src/index.ts:69](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L69)

___

### event

• **event**: `LifeCycleStore`<`Instance`\>

#### Defined in

[src/index.ts:44](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L44)

___

### router

• `Private` **router**: `Router`

#### Defined in

[src/index.ts:70](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L70)

___

### routes

• `Protected` **routes**: [`InternalRoute`](../interfaces/InternalRoute.md)<`Instance`\>[] = `[]`

#### Defined in

[src/index.ts:71](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L71)

___

### server

• **server**: ``null`` \| `Server` = `null`

#### Defined in

[src/index.ts:67](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L67)

___

### store

• **store**: `Instance`[``"store"``]

#### Defined in

[src/index.ts:41](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L41)

## Methods

### \_addHandler

▸ `Private` **_addHandler**<`Schema`, `Path`\>(`method`, `path`, `handler`, `hook?`): `void`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `method` | [`HTTPMethod`](../modules.md#httpmethod) |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`any`, [`KingWorldInstance`](../interfaces/KingWorldInstance.md)<{ `request`: `Record`<[`KWKey`](../modules.md#kwkey), `any`\> ; `store`: `Record`<[`KWKey`](../modules.md#kwkey), `any`\>  }\>\> |

#### Returns

`void`

#### Defined in

[src/index.ts:94](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L94)

___

### afterHandle

▸ **afterHandle**<`Route`\>(`handler`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](../interfaces/TypedRoute.md) = [`TypedRoute`](../interfaces/TypedRoute.md) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | `AfterRequestHandler`<`Route`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:182](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L182)

___

### connect

▸ **connect**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:391](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L391)

___

### decorate

▸ **decorate**<`Name`, `Callback`, `NewInstance`\>(`name`, `value`): `NewInstance`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Name` | extends `string` |
| `Callback` | extends `Function` = () => `unknown` |
| `NewInstance` | [`default`](default.md)<{ `request`: `Instance`[``"request"``] & { [key in string]: Callback } ; `store`: `Instance`[``"store"``]  }\> |

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `Name` |
| `value` | `Callback` |

#### Returns

`NewInstance`

#### Defined in

[src/index.ts:438](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L438)

___

### delete

▸ **delete**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:339](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L339)

___

### get

▸ **get**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:293](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L293)

___

### getSchema

▸ `Private` **getSchema**(`schema`): `undefined` \| { `$schema`: ``"http://json-schema.org/draft-07/schema#"``  } & { `default?`: `any` ; `description?`: `string`  }

#### Parameters

| Name | Type |
| :------ | :------ |
| `schema` | `undefined` \| `ZodType`<`any`, `ZodTypeDef`, `any`\> |

#### Returns

`undefined` \| { `$schema`: ``"http://json-schema.org/draft-07/schema#"``  } & { `default?`: `any` ; `description?`: `string`  }

#### Defined in

[src/index.ts:82](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L82)

___

### getSchemaValidator

▸ `Private` **getSchemaValidator**(`schema`): `undefined` \| `ValidateFunction`

#### Parameters

| Name | Type |
| :------ | :------ |
| `schema` | `undefined` \| `ZodType`<`any`, `ZodTypeDef`, `any`\> |

#### Returns

`undefined` \| `ValidateFunction`

#### Defined in

[src/index.ts:88](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L88)

___

### group

▸ **group**(`prefix`, `run`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `prefix` | `string` |
| `run` | (`group`: [`default`](default.md)<`Instance`\>) => `void` |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:245](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L245)

___

### guard

▸ **guard**(`hook`, `run`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `hook` | [`RegisterHook`](../interfaces/RegisterHook.md)<{}, `Instance`\> |
| `run` | (`group`: [`default`](default.md)<`Instance`\>) => `void` |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:265](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L265)

___

### handle

▸ **handle**(`request`): `Promise`<`Response`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `request` | `Request` |

#### Returns

`Promise`<`Response`\>

#### Defined in

[src/index.ts:452](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L452)

___

### handleError

▸ `Private` **handleError**(`err`): `Response`

#### Parameters

| Name | Type |
| :------ | :------ |
| `err` | `Error` |

#### Returns

`Response`

#### Defined in

[src/index.ts:567](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L567)

___

### head

▸ **head**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:365](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L365)

___

### listen

▸ **listen**(`options`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `number` \| `Omit`<`Serve`<`undefined`\>, ``"fetch"``\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:600](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L600)

___

### method

▸ **method**<`Schema`, `Path`\>(`method`, `path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `method` | [`HTTPMethod`](../modules.md#httpmethod) |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:404](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L404)

___

### on

▸ **on**<`Event`\>(`type`, `handler`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Event` | extends [`LifeCycleEvent`](../modules.md#lifecycleevent) = [`LifeCycleEvent`](../modules.md#lifecycleevent) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `Event` |
| `handler` | [`LifeCycle`](../interfaces/LifeCycle.md)<`Instance`\>[`Event`] |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:202](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L202)

___

### onBeforeHandle

▸ **onBeforeHandle**<`Route`\>(`handler`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](../interfaces/TypedRoute.md) = [`TypedRoute`](../interfaces/TypedRoute.md) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | [`Handler`](../modules.md#handler)<`Route`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:174](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L174)

___

### onError

▸ **onError**(`errorHandler`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `errorHandler` | [`ErrorHandler`](../modules.md#errorhandler) |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:190](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L190)

___

### onParse

▸ **onParse**(`parser`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `parser` | [`BodyParser`](../modules.md#bodyparser) |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:160](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L160)

___

### onRequest

▸ **onRequest**(`handler`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | [`BeforeRequestHandler`](../modules.md#beforerequesthandler)<`Instance`[``"store"``]\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:154](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L154)

___

### onStart

▸ **onStart**(`handler`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | `VoidLifeCycle` |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:148](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L148)

___

### onStop

▸ **onStop**(`handler`): [`default`](default.md)<`Instance`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | `VoidLifeCycle` |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:196](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L196)

___

### onTransform

▸ **onTransform**<`Route`\>(`handler`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](../interfaces/TypedRoute.md) = [`TypedRoute`](../interfaces/TypedRoute.md) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | [`Handler`](../modules.md#handler)<`Route`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:166](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L166)

___

### options

▸ **options**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:352](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L352)

___

### patch

▸ **patch**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:326](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L326)

___

### post

▸ **post**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:303](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L303)

___

### put

▸ **put**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:316](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L316)

___

### state

▸ **state**<`Key`, `Value`, `ReturnValue`, `NewInstance`\>(`name`, `value`): `NewInstance`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Key` | extends [`KWKey`](../modules.md#kwkey) = keyof `Instance`[``"store"``] |
| `Value` | `Instance`[``"store"``][keyof `Instance`[``"store"``]] |
| `ReturnValue` | `Value` extends () => `Returned` ? `Returned` extends `Promise`<`AsyncReturned`\> ? `AsyncReturned` : `Returned` : `Value` |
| `NewInstance` | [`default`](default.md)<{ `request`: `Instance`[``"request"``] ; `store`: `Instance`[``"store"``] & { [key in KWKey]: ReturnValue }  }\> |

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `Key` |
| `value` | `Value` |

#### Returns

`NewInstance`

#### Defined in

[src/index.ts:418](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L418)

___

### stop

▸ **stop**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

#### Defined in

[src/index.ts:622](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L622)

___

### trace

▸ **trace**<`Schema`, `Path`\>(`path`, `handler`, `hook?`): [`default`](default.md)<`Instance`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Schema` | extends [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }, `Schema`\> = [`TypedSchema`](../interfaces/TypedSchema.md)<{ `body`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `header`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `params`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `query`: `ZodType`<`any`, `ZodTypeDef`, `any`\> ; `response`: `ZodType`<`any`, `ZodTypeDef`, `any`\>  }\> |
| `Path` | extends `string` = `string` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `Path` |
| `handler` | [`LocalHandler`](../modules.md#localhandler)<`Schema`, `Instance`, `Path`\> |
| `hook?` | [`LocalHook`](../interfaces/LocalHook.md)<`Schema`, `Instance`\> |

#### Returns

[`default`](default.md)<`Instance`\>

#### Defined in

[src/index.ts:378](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L378)

___

### use

▸ **use**<`Config`, `T`\>(`plugin`, `config?`): `T`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Config` | extends `Record`<`string`, `unknown`\> = `Record`<`string`, `unknown`\> |
| `T` | extends [`default`](default.md)<`any`, `T`\> = [`default`](default.md)<`any`\> |

#### Parameters

| Name | Type |
| :------ | :------ |
| `plugin` | (`app`: [`default`](default.md)<`Instance`\>, `config?`: `Config`) => `T` |
| `config?` | `Config` |

#### Returns

`T`

#### Defined in

[src/index.ts:281](https://github.com/gaurishhs/kingworld/blob/998f83a/src/index.ts#L281)
