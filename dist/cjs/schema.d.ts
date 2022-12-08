import type { TSchema } from '@sinclair/typebox';
import type { HTTPMethod, LocalHook } from './types';
export declare const toOpenAPIPath: (path: string) => string;
export declare const mapProperties: (name: string, schema: TSchema | undefined) => {
    in: string;
    name: string;
    type: any;
    required: any;
}[];
export declare const registerSchemaPath: ({ schema, path, method, hook }: {
    schema: Record<string, Object>;
    path: string;
    method: HTTPMethod;
    hook?: LocalHook<any, import("./types").ElysiaInstance<{
        store: {};
        request: {};
        schema: {};
    }>, string> | undefined;
}) => void;
