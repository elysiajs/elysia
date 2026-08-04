import { formatErrorAsJSON } from '../../utils/errorFormatter.js';

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

});

it('should format an error with both name and message as empty strings correctly', () => {
  const emptyError = {
    name: '',
    message: ''
  };
  const formattedError = formatErrorAsJSON(emptyError);
  expect(formattedError).toEqual({
    name: '',
    message: ''
});

it('should format a validation error with deeply nested structures correctly', () => {
  const deeplyNestedValidationError = {
    code: 'VALIDATION',
    all: [
      { message: 'Deeply nested object is invalid', path: ['deeply', 'nested', 'object'] }
  });
    const formattedDeeplyNestedError = formatErrorAsJSON(deeplyNestedValidationError);
    expect(formattedDeeplyNestedError).toEqual({
      errors: [
        { message: 'Deeply nested object is invalid', path: ['deeply', 'nested', 'object'] }
      ]
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
      { message: 'First nested object is invalid', path: ['first', 'nested', 'object'] },
      { message: 'Second nested object is invalid', path: ['second', 'nested', 'object'] }
    ]
  });
    ]
  });
});
it('should format a null error correctly', () => {
  const nullError = null;
  const formattedNullError = formatErrorAsJSON(nullError);
  expect(formattedNullError).toEqual({});
});
it('should format an undefined error correctly', () => {
  const undefinedError = undefined;
  const formattedUndefinedError = formatErrorAsJSON(undefinedError);