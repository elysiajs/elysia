const errorCodeToStatus = new Map();
errorCodeToStatus.set('BODY_LIMIT', 400);
errorCodeToStatus.set('INTERNAL_SERVER_ERROR', 500);
errorCodeToStatus.set('NOT_FOUND', 404);
errorCodeToStatus.set('VALIDATION', 400);
const knownErrors = new Set(errorCodeToStatus.keys());
export const mapErrorCode = (error) => knownErrors.has(error) ? error : 'UNKNOWN';
export const mapErrorStatus = (error) => errorCodeToStatus.get(error) ?? 500;
