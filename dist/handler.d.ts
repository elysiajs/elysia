/// <reference types="bun-types" />
import type { Context } from './context';
export declare const mapEarlyResponse: (response: unknown, context: Context) => Response | undefined;
export declare const mapResponse: (response: unknown, context: Context) => any;
export declare const errorToResponse: (error: Error, headers?: HeadersInit) => Response;
