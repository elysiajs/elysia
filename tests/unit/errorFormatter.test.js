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
      name: 'NOT_FOUND',
      message: 'Resource not found'
    });
  });

  it('should format an internal server error correctly', () => {
    const internalServerError = {
      name: 'InternalServerError',
      message: 'Internal Server Error'
    };
    const formattedError = formatErrorAsJSON(internalServerError);
    expect(formattedError).toEqual({
      name: 'InternalServerError',
      message: 'Internal Server Error'
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

  it('should format an error with no name correctly', () => {
    const noNameError = {
      message: 'No name provided'
    };
    const formattedError = formatErrorAsJSON(noNameError);
    expect(formattedError).toEqual({
      name: undefined,
      message: 'No name provided'
    });
  });

  it('should format an error with no message correctly', () => {
    const noMessageError = {
      name: 'NoMessageError',
      message: undefined
it('should format an error with no message correctly', () => {
  const noMessageError = {
    name: 'NoMessageError',
    message: undefined
  };
  const formattedError = formatErrorAsJSON(noMessageError);
it('should format a null error correctly', () => {
  const nullError = null;
  const formattedNullError = formatErrorAsJSON(nullError);
  expect(formattedNullError).toEqual({
    name: undefined,
    message: undefined
  });
});

it('should format an undefined error correctly', () => {
  const undefinedError = undefined;
  const formattedUndefinedError = formatErrorAsJSON(undefinedError);
  expect(formattedUndefinedError).toEqual({
    name: undefined,
    message: undefined
  });
});
      name: '',
      message: ''
    });
  });

it('should format a validation error with nested arrays correctly', () => {
  const nestedArrayValidationError = {
    code: 'VALIDATION',
    all: [
      { message: 'Nested array is invalid', path: ['nested', 'array'] }
    ]
  };
  const formattedNestedArrayValidationError = formatErrorAsJSON(nestedArrayValidationError);
  expect(formattedNestedArrayValidationError).toEqual({
    errors: [
      { message: 'Nested array is invalid', path: ['nested', 'array'] }
    ]
  });
});

    it('should format a validation error with nested arrays correctly', () => {
      const nestedArrayValidationError = {
        code: 'VALIDATION',
        all: [
          { message: 'Nested array is invalid', path: ['array', 0, 'property'] }
        ]
      };
      const formattedNestedArrayValidationError = formatErrorAsJSON(nestedArrayValidationError);
      expect(formattedNestedArrayValidationError).toEqual({
        errors: [
          { message: 'Nested array is invalid', path: ['array', 0, 'property'] }
        ]
      });
    });

    it('should format a validation error with nested objects correctly', () => {
      const nestedObjectValidationError = {
        code: 'VALIDATION',
        all: [
          { message: 'Nested object is invalid', path: ['object', 'nested', 'property'] }
        ]
      };
      const formattedNestedObjectValidationError = formatErrorAsJSON(nestedObjectValidationError);
      expect(formattedNestedObjectValidationError).toEqual({
        errors: [
          { message: 'Nested object is invalid', path: ['object', 'nested', 'property'] }
        ]
      });
    });

    it('should format an error with malformed structure correctly', () => {
      const malformedError = {
        code: 'MALFORMED',
        message: 'Malformed error structure'
      };
      const formattedMalformedError = formatErrorAsJSON(malformedError);
      expect(formattedMalformedError).toEqual({
        name: undefined,
        message: 'Malformed error structure'
      });
    });

    it('should format an error with no message correctly', () => {
      const noMessageError = {
        name: 'NoMessageError'
      };
      const formattedNoMessageError = formatErrorAsJSON(noMessageError);
      expect(formattedNoMessageError).toEqual({
        name: 'NoMessageError',
        message: undefined
      });
    });
    const formattedDeeplyNestedError = formatErrorAsJSON(deeplyNestedValidationError);
    expect(formattedDeeplyNestedError).toEqual({
      errors: [
        { message: 'Deeply nested object is invalid', path: ['deeply', 'nested', 'object'] }
      ]
    });
  });

  it('should format a validation error with an empty `all` property correctly', () => {
    const missingAllPropertyValidationError = {
      code: 'VALIDATION',
      all: []
    };
    const formattedMissingAllPropertyError = formatErrorAsJSON(missingAllPropertyValidationError);
    expect(formattedMissingAllPropertyError).toEqual({
      errors: []
    });
  });

  it('should format a validation error with a malformed `all` property correctly', () => {
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