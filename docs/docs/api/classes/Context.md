# Class: Context<Route, Store\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](../interfaces/TypedRoute.md) = [`TypedRoute`](../interfaces/TypedRoute.md) |
| `Store` | extends [`default`](default.md)[``"store"``] = [`default`](default.md)[``"store"``] |

## Table of contents

### Constructors

- [constructor](Context.md#constructor)

### Properties

- [\_redirect](Context.md#_redirect)
- [\_status](Context.md#_status)
- [body](Context.md#body)
- [params](Context.md#params)
- [query](Context.md#query)
- [request](Context.md#request)
- [responseHeaders](Context.md#responseheaders)
- [store](Context.md#store)

### Methods

- [redirect](Context.md#redirect)
- [status](Context.md#status)

## Constructors

### constructor

• **new Context**<`Route`, `Store`\>(`x`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `Route` | extends [`TypedRoute`](../interfaces/TypedRoute.md) = [`TypedRoute`](../interfaces/TypedRoute.md) |
| `Store` | extends `Record`<[`KWKey`](../modules.md#kwkey), `any`\> = `Record`<[`KWKey`](../modules.md#kwkey), `any`\> |

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `Object` |
| `x.body` | `Route`[``"body"``] |
| `x.params` | `Route`[``"params"``] |
| `x.query` | `Route`[``"query"``] extends `Record`<`string`, `any`\> ? `any`[`any`] : `Record`<`string`, `string`\> |
| `x.request` | `Request` |
| `x.store` | `Store` |

#### Defined in

[src/context.ts:21](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L21)

## Properties

### \_redirect

• `Optional` **\_redirect**: `string`

#### Defined in

[src/context.ts:19](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L19)

___

### \_status

• **\_status**: `number` = `200`

#### Defined in

[src/context.ts:8](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L8)

___

### body

• **body**: `Route`[``"body"``]

#### Defined in

[src/context.ts:16](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L16)

___

### params

• **params**: `Route`[``"params"``]

#### Defined in

[src/context.ts:15](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L15)

___

### query

• **query**: `Route`[``"query"``] extends `Record`<`string`, `any`\> ? `any`[`any`] : `Record`<`string`, `string`\>

#### Defined in

[src/context.ts:12](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L12)

___

### request

• **request**: `Request`

#### Defined in

[src/context.ts:11](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L11)

___

### responseHeaders

• **responseHeaders**: `Record`<`string`, `string`\> = `{}`

#### Defined in

[src/context.ts:9](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L9)

___

### store

• **store**: `Store`

#### Defined in

[src/context.ts:17](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L17)

## Methods

### redirect

▸ **redirect**(`path`, `status?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `path` | `string` | `undefined` |
| `status` | `number` | `301` |

#### Returns

`void`

#### Defined in

[src/context.ts:41](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L41)

___

### status

▸ **status**(`code`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `code` | `number` |

#### Returns

`void`

#### Defined in

[src/context.ts:37](https://github.com/gaurishhs/kingworld/blob/c7ebe24/src/context.ts#L37)
