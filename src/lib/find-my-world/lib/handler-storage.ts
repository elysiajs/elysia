import type { Handler } from './types'

interface HandlerObject<Store = Record<string, any>> {
    handler: Handler
    params: Record<string, any>
    store: Store
    _createParamsObject: (
        params: string[]
    ) => Record<string, string | undefined>
}

export default class HandlerStorage {
    handlers: HandlerObject[]
    unconstrainedHandler: HandlerObject | null

    constructor() {
        this.handlers = []
        this.unconstrainedHandler = null
    }

    addHandler(handler: Handler, params: string[], store: any) {
        const handlerObject: HandlerObject = {
            handler,
            params,
            _createParamsObject: this._compileCreateParamsObject(params),
            store: store || null
        }

        this.unconstrainedHandler = handlerObject

        if (this.handlers.length >= 32)
            throw new Error(
                'find-my-world supports a maximum of 32 route handlers per node when there are constraints, limit reached'
            )

        this.handlers.push(handlerObject)
    }

    _compileCreateParamsObject(keys: string[]) {
        return (value: string[]) => {
            const params = {}

            keys.forEach((key, index) => (params[key] = value[index]))

            return params
        }
    }
}
