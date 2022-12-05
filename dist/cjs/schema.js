"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSchemaPath = exports.mapProperties = exports.toOpenAPIPath = void 0;
const toOpenAPIPath = (path) => path
    .split('/')
    .map((x) => (x.startsWith(':') ? `{${x.slice(1, x.length)}}` : x))
    .join('/');
exports.toOpenAPIPath = toOpenAPIPath;
const mapProperties = (name, schema) => Object.entries(schema?.properties ?? []).map(([key, value]) => ({
    in: name,
    name: key,
    // @ts-ignore
    type: value?.type,
    required: schema.required?.includes(key) ?? false
}));
exports.mapProperties = mapProperties;
const registerSchemaPath = ({ schema, path, method, hook }) => {
    path = (0, exports.toOpenAPIPath)(path);
    const bodySchema = hook?.schema?.body;
    const paramsSchema = hook?.schema?.params;
    const headerSchema = hook?.schema?.header;
    const querySchema = hook?.schema?.query;
    const responseSchema = hook?.schema?.response;
    const parameters = [
        ...(0, exports.mapProperties)('header', headerSchema),
        ...(0, exports.mapProperties)('path', paramsSchema),
        ...(0, exports.mapProperties)('query', querySchema)
    ];
    if (bodySchema)
        parameters.push({
            in: 'body',
            name: 'body',
            required: true,
            // @ts-ignore
            schema: bodySchema
        });
    schema[path] = {
        ...(schema[path] ? schema[path] : {}),
        [method.toLowerCase()]: {
            ...(headerSchema || paramsSchema || querySchema || bodySchema
                ? { parameters }
                : {}),
            ...(responseSchema
                ? {
                    responses: {
                        '200': {
                            description: 'Default response',
                            schema: responseSchema
                        }
                    }
                }
                : {})
        }
    };
};
exports.registerSchemaPath = registerSchemaPath;
