import { formatErrorAsJSON } from '../../utils/errorFormatter.js';

import { expect } from 'chai';
describe('formatErrorAsJSON', () => {
  it('should format a validation error correctly', () => {
    const validationError = {
      code: 'VALIDATION',
      all: [
        { message: 'Username is required', path: ['username'] },
        { message: 'Password must be at least 8 characters long', path: ['password'] }
      ]
    };
    const formattedError = formatErrorAsJSON(validationError);
    expect(formattedError).toEqual({
      errors: [
        { message: 'Username is required', path: ['username'] },
        { message: 'Password must be at least 8 characters long', path: ['password'] }
      ]
    });
  });

  it('should format a generic error correctly', () => {
    const genericError = {
      name: 'TypeError',
      code: 'GENERIC_ERROR',
      message: 'Invalid input type'
    };
    const formattedError = formatErrorAsJSON(genericError);
    expect(formattedError).toEqual({
      name: 'TypeError',
      message: 'Invalid input type'
    });
  });

  it('should format a not found error correctly', () => {
    const notFoundError = {
      code: 'NOT_FOUND',
      message: 'Resource not found'
    };
    const formattedError = formatErrorAsJSON(notFoundError);
    expect(formattedError).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found'
    });
  });

  it('should format a custom error with additional details correctly', () => {
    const customError = {
      name: 'CustomError',
      message: 'Something went wrong',
      details: { key: 'value' }
    };
    const formattedError = formatErrorAsJSON(customError);
    expect(formattedError).toEqual({
      name: 'CustomError',
      message: 'Something went wrong',
      details: { key: 'value' }
    });
  });

  it('should format a bad request error correctly', () => {
    const badRequestError = {
      code: 'BAD_REQUEST',
      message: 'Bad Request'
    };
    const formattedError = formatErrorAsJSON(badRequestError);
    expect(formattedError).toEqual({
      code: 'BAD_REQUEST',
      message: 'Bad Request'
    });
  });

  it('should format an unauthorized error correctly', () => {
    const unauthorizedError = {
      code: 'UNAUTHORIZED',
      message: 'Unauthorized'
    };
    const formattedError = formatErrorAsJSON(unauthorizedError);
    expect(formattedError).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized'
    });
  });

    });

    it('should format a validation error with nested arrays correctly', () => {
      const nestedArrayValidationError = {
        code: 'VALIDATION',
        all: [
          { message: 'Nested array is invalid', path: ['nested', 'array'] }
        ]
      };
      const formattedError = formatErrorAsJSON(nestedArrayValidationError);
      expect(formattedError).toEqual({
        errors: [
          { message: 'Nested array is invalid', path: ['nested', 'array'] }
        ]
      });
    });

    it('should format a null error correctly', () => {
it('should format a null error correctly', () => {
  const nullError = null;
  const formattedError = formatErrorAsJSON(nullError);
  expect(formattedError).toEqual({});
});

it('should format an undefined error correctly', () => {
  const undefinedError = undefined;
  const formattedError = formatErrorAsJSON(undefinedError);
  expect(formattedError).toEqual({});
});
      const unexpectedPropertiesError = {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred',
        unexpectedField: 'value'
      };
      const formattedError = formatErrorAsJSON(unexpectedPropertiesError);
      expect(formattedError).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred'
      });
    });

    it('should format a malformed error structure correctly', () => {
      const malformedError = {
        invalidProperty: 'value'
      };
      const formattedError = formatErrorAsJSON(malformedError);
      expect(formattedError).toEqual({});
    });
      });
    });
      expect(formattedError).toEqual({
        errors: [
          { message: 'Nested object is invalid', path: ['object', 'nested', 'property'] }
        ]
      });
       const formattedError = formatErrorAsJSON(unexpectedPropertiesError);
        expect(formattedError).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred'
      code: 'VALIDATION',
      all: [
        { message: 'Nested object is invalid', path: ['object', 'nested', 'property'] }
      ]
    };
    const formattedError = formatErrorAsJSON(nestedObjectValidationError);
    expect(formattedError).toEqual({
      errors: [
        { message: 'Nested object is invalid', path: ['object', 'nested', 'property'] }
      ]
    });
  });

  it('should format an error with malformed structure correctly', () => {
    const malformedError = {
      message: 'Malformed error'
    };
    const formattedError = formatErrorAsJSON(malformedError);
    expect(formattedError).toEqual({
      message: 'Malformed error'
    });
  });

  it('should format an empty error object correctly', () => {
    const emptyError = {};
    const formattedError = formatErrorAsJSON(emptyError);
    expect(formattedError).toEqual({
      name: undefined,
      message: undefined
    });
  });
});
       ]
    });
  });

  it('should format an error with malformed structure correctly', () => {
    const malformedError = {
      code: 'MALFORMED',
      message: 'Malformed error structure'
    };
    const formattedError = formatErrorAsJSON(malformedError);
    expect(formattedError).toEqual({
      name: undefined,
      message: 'Malformed error structure'
    });
  });

  it('should format a validation error with an empty `all` property correctly', () => {
    const missingAllPropertyValidationError = {
      code: 'VALIDATION',
      all: []
    };
    const formattedError = formatErrorAsJSON(missingAllPropertyValidationError);
    expect(formattedError).toEqual({
      errors: []
    });
  });

  it('should format a validation error with a malformed `all` property correctly', () => {
    const malformedStructureError = {
      code: 'VALIDATION',
      all: 'not an array'
    };
    const formattedError = formatErrorAsJSON(malformedStructureError);
    expect(formattedError).toEqual({
      errors: []
    });
  });
});
    const malformedStructureError = {
      code: 'VALIDATION',
      all: 'not an array'
    };
    const formattedMalformedStructureError = formatErrorAsJSON(malformedStructureError);
    expect(formattedMalformedStructureError).toEqual({
      errors: []
    });
  });

  it('should format an unexpected structure error correctly', () => {
    const unexpectedStructureError = {
      unexpectedKey: 'value'
    };
    const formattedUnexpectedStructureError = formatErrorAsJSON(unexpectedStructureError);
    expect(formattedUnexpectedStructureError).toEqual({
      name: undefined,
      message: undefined
    });
  });
    expect(formattedUnexpectedStructureError).toEqual({
      message: undefined
    const badRequestError = {
      code: 'BAD_REQUEST',
      message: 'Bad Request'
    };
    const formattedBadRequestError = formatErrorAsJSON(badRequestError);
      name: 'BAD_REQUEST',
    const unauthorizedError = {
      code: 'UNAUTHORIZED',
      message: 'Unauthorized'
    };
    const formattedUnauthorizedError = formatErrorAsJSON(unauthorizedError);
    expect(formattedUnauthorizedError).toEqual({
      name: 'UNAUTHORIZED',
      message: 'Unauthorized'
    });
      const formattedNonArrayAllPropertyError = formatErrorAsJSON(nonArrayAllPropertyValidationError);
      expect(formattedNonArrayAllPropertyError).toEqual({
        errors: []
      });
    });
    it('should format a validation error with nested arrays correctly', () => {
      const nestedArrayValidationError = {
        code: 'VALIDATION',
        all: [
          { message: 'Nested array is invalid', path: ['user', 'roles', 0] }
    });
      expect(formattedNonArrayAllPropertyError).toEqual({
        errors: []
      });
    });
      const nestedArrayValidationError = {
        code: 'VALIDATION',
        ]
      });
    });

    it('should format a validation error with nested objects correctly', () => {
      const nestedObjectValidationError = {
        code: 'VALIDATION',
        all: [
          { message: 'Nested property is invalid', path: ['user', 'address', 'city'] }
        ]
      };
      const formattedNestedObjectError = formatErrorAsJSON(nestedObjectValidationError);
      expect(formattedNestedObjectError).toEqual({
        errors: [
          { message: 'Nested property is invalid', path: ['user', 'address', 'city'] }
        ]
      });
    });

    it('should format an error with unexpected structure correctly', () => {
      const unexpectedStructureError = {
        unexpectedKey: 'unexpectedValue',
        message: 'Unexpected structure error'
      };
      const formattedUnexpectedStructureError = formatErrorAsJSON(unexpectedStructureError);
      expect(formattedUnexpectedStructureError).toEqual({
        name: undefined,
        message: 'Unexpected structure error'
      });
    });

    it('should format an error with malformed structure correctly', () => {
    it('should format a null error correctly', () => {
      const nullError = null;
      const formattedNullError = formatErrorAsJSON(nullError);
      expect(formattedNullError).toEqual({});
    });
        message: undefined
      });
    it('should format an undefined error correctly', () => {
      const undefinedError = undefined;
      const formattedUndefinedError = formatErrorAsJSON(undefinedError);
      expect(formattedUndefinedError).toEqual({});
    });
    expect(formattedNullError).toEqual({});
  });

  it('should format an undefined error correctly', () => {
    const undefinedError = undefined;
    const formattedUndefinedError = formatErrorAsJSON(undefinedError);
    expect(formattedUndefinedError).toEqual({});
  });
});