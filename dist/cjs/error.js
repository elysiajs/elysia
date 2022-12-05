"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapErrorCode = void 0;
const knownErrors = new Set([
    'BODY_LIMIT',
    'BODY_LIMIT',
    'INTERNAL_SERVER_ERROR',
    'NOT_FOUND',
    'VALIDATION'
]);
const mapErrorCode = (error) => knownErrors.has(error) ? error : 'UNKNOWN';
exports.mapErrorCode = mapErrorCode;
