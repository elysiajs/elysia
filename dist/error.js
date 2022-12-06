const knownErrors = new Set([
    'BODY_LIMIT',
    'BODY_LIMIT',
    'INTERNAL_SERVER_ERROR',
    'NOT_FOUND',
    'VALIDATION'
]);
export const mapErrorCode = (error) => knownErrors.has(error) ? error : 'UNKNOWN';
