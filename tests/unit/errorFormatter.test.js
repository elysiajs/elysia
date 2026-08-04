import { formatErrorAsJSON } from '../../utils/errorFormatter.js';

import { expect } from 'vitest';
it('should format a validation error with details', () => {
  const validationError = {
    code: 'VALIDATION',
    error: {
      all: [
        {
          field: 'username',
          message: 'Username is required'
        }
      ]
    }
  };
  const formattedError = formatErrorAsJSON(validationError);
  expect(formattedError).toEqual({
    code: 'VALIDATION',
    errors: [{
      field: 'username',
      message: 'Username is required'
    }]
  });
});
it('should format a generic error with name and message', () => {
  const genericError = {
    name: 'TypeError',
    message: 'Invalid input type'
  };
      message: 'Password must be at least 8 characters long'
  expect(formattedError).toEqual({
    name: 'TypeError',
    message: 'Invalid input type'
  });
});
it('should format an error with additional properties', () => {
  const errorWithDetails = {
    code: 'NOT_FOUND',
    error: {
      message: 'User not found'
      details: 'The requested resource does not exist.'
    }
  };
  const formattedError = formatErrorAsJSON(errorWithDetails);
  expect(formattedError).toEqual({
    code: 'NOT_FOUND',
    message: 'Resource not found',
    details: 'The requested resource does not exist.'
  });
      message: 'Internal server error'
      message: 'Username is required'
    }]
  });
});
it('should format a generic error with name and message', () => {
  const genericError = {
    name: 'TypeError',
    message: 'Invalid input type'
  };
      message: 'Unauthorized access'
  expect(formattedError).toEqual({
    name: 'TypeError',
    message: 'Invalid input type'
  });
});
it('should format an error with additional properties', () => {
  const detailedError = {
    code: 'NOT_FOUND',
    error: {
      message: 'Resource not found',
      details: 'The requested resource does not exist'
    }
  };
  const formattedError = formatErrorAsJSON(detailedError);
  expect(formattedError).toEqual({
    code: 'NOT_FOUND',
    message: 'Resource not found',
    details: 'The requested resource does not exist'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error', () => {
  const genericError = {
    name: 'TypeError',
    message: 'Invalid input'
  };
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    name: 'TypeError',
    message: 'Invalid input'
  });
});
it('should format an error with additional properties', () => {
  const errorWithProps = {
    code: 'UNKNOWN_ERROR',
    error: {
      message: 'Something went wrong',
      details: 'More details here'
    }
  };
  const formattedError = formatErrorAsJSON(errorWithProps);
  expect(formattedError).toEqual({
    code: 'UNKNOWN_ERROR',
    message: 'Something went wrong',
    details: 'More details here'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error', () => {
  const genericError = {
    name: 'TypeError',
    message: 'Invalid input'
  };
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    name: 'TypeError',
    message: 'Invalid input'
  });
});
it('should handle an error with no additional details', () => {
  const simpleError = {
    message: 'Something went wrong'
  };
  const formattedError = formatErrorAsJSON(simpleError);
  expect(formattedError).toEqual({
    message: 'Something went wrong'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error with name and message', () => {
  const genericError = {
    code: 'GENERIC_ERROR',
    error: new Error('Something went wrong')
  };
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    code: 'GENERIC_ERROR',
    name: 'Error',
    message: 'Something went wrong'
  });
});
it('should format an error with additional properties', () => {
  const detailedError = {
    code: 'DETAILED_ERROR',
    error: {
      name: 'DetailedError',
      message: 'Detailed error message',
      details: 'More details here'
    }
  };
  const formattedError = formatErrorAsJSON(detailedError);
  expect(formattedError).toEqual({
    code: 'DETAILED_ERROR',
    name: 'DetailedError',
    message: 'Detailed error message',
    details: 'More details here'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error', () => {
  const genericError = {
    code: 'GENERIC_ERROR',
    error: new Error('Something went wrong')
  };
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    code: 'GENERIC_ERROR',
    message: 'Something went wrong'
  });
});
it('should handle errors without details', () => {
  const simpleError = {
    code: 'SIMPLE_ERROR'
  };
  const formattedError = formatErrorAsJSON(simpleError);
  expect(formattedError).toEqual({
    code: 'SIMPLE_ERROR',
    message: undefined
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error', () => {
  const genericError = {
    name: 'TypeError',
    message: 'Invalid input'
  };
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    name: 'TypeError',
    message: 'Invalid input'
  });
});
it('should handle errors without details', () => {
  const errorWithoutDetails = {
    name: 'Error',
    message: 'An unexpected error occurred'
  };
  const formattedError = formatErrorAsJSON(errorWithoutDetails);
  expect(formattedError).toEqual({
    name: 'Error',
    message: 'An unexpected error occurred'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error with name and message', () => {
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
it('should format an error with additional properties', () => {
  const errorWithProps = {
    name: 'CustomError',
    message: 'Something went wrong',
    details: 'More information here'
  };
  const formattedError = formatErrorAsJSON(errorWithProps);
  expect(formattedError).toEqual({
    name: 'CustomError',
    message: 'Something went wrong',
    details: 'More information here'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error', () => {
  const genericError = {
    name: 'GenericError',
    message: 'An unexpected error occurred'
  };
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    name: 'GenericError',
    message: 'An unexpected error occurred'
  });
});
it('should format a TypeError', () => {
  const typeError = new TypeError('Invalid type');
  const formattedError = formatErrorAsJSON(typeError);
  expect(formattedError).toEqual({
    name: 'TypeError',
    message: 'Invalid type'
  });
});
      message: 'Username is required'
    }]
  });
});
it('should format a generic error', () => {
  const genericError = new Error('Something went wrong');
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    name: 'Error',
    message: 'Something went wrong'
  });
});
            message: 'Username is required',
          },
        ],
      },
    };
    const formattedError = formatErrorAsJSON(validationError);
    expect(formattedError).toEqual({
      errors: [
        {
          path: ['username'],
          message: 'Username is required',
        },
      ],
    });
  });

  it('should format a generic error', () => {
    const genericError = new Error('Something went wrong');
    const formattedError = formatErrorAsJSON(genericError);
    expect(formattedError).toEqual({
      name: 'Error',
      message: 'Something went wrong',
    });
  });

  it('should format a custom error with additional properties', () => {
    const customError = {
      name: 'CustomError',
      message: 'Custom message',
      statusCode: 400,
      details: 'Additional details',
    };
    const formattedError = formatErrorAsJSON(customError);
    expect(formattedError).toEqual({
      name: 'CustomError',
      message: 'Custom message',
      statusCode: 400,
      details: 'Additional details',
    });
  });
    }
  };
  const formattedError = formatErrorAsJSON(validationError);
  expect(formattedError).toEqual({
    code: 'VALIDATION',
    errors: [{ field: 'username', message: 'Username is required' }]
  });
});
it('should format a generic error with name and message', () => {
  const genericError = new Error('Something went wrong');
  const formattedError = formatErrorAsJSON(genericError);
  expect(formattedError).toEqual({
    name: 'Error',
    message: 'Something went wrong'
  });
});
it('should format a custom error with additional properties', () => {
  const customError = {
    name: 'CustomError',
    message: 'Custom error occurred',
    details: 'Additional details here'
  };
  const formattedError = formatErrorAsJSON(customError);
  expect(formattedError).toEqual({
    name: 'CustomError',
    message: 'Custom error occurred',
    details: 'Additional details here'
  });
});
            message: 'Required'
          }
        ]
      }
    };
    const formattedError = formatErrorAsJSON(validationError);
    expect(formattedError).toEqual({
      code: 'VALIDATION',
      errors: [{ path: ['username'], message: 'Required' }]
    });
  });

  it('should format a generic error', () => {
    const genericError = new Error('Something went wrong');
    const formattedError = formatErrorAsJSON(genericError);
    expect(formattedError).toEqual({
      name: 'Error',
      message: 'Something went wrong'
    });
  });

  it('should format a custom error with additional properties', () => {
    const customError = {
      name: 'CustomError',
      message: 'Custom message',
      statusCode: 400,
      details: { field: 'value' }
    };
    const formattedError = formatErrorAsJSON(customError);
    expect(formattedError).toEqual({
      name: 'CustomError',
      message: 'Custom message',
      statusCode: 400,
      details: { field: 'value' }
    });
  });
          path: ['username'],
          message: 'Username is required',
        },
        {
          path: ['password'],
          message: 'Password must be at least 8 characters long',
        },
      ],
    },
  };
  const expectedOutput = {
    code: 'VALIDATION',
    errors: [
      {
        path: ['username'],
        message: 'Username is required',
      },
      {
        path: ['password'],
        message: 'Password must be at least 8 characters long',
      },
    ],
  };
  expect(formatErrorAsJSON(validationError)).toEqual(expectedOutput);
});

it('should format a generic error with name and message', () => {
  const genericError = new Error('Something went wrong');
  const expectedOutput = {
    name: 'Error',
    message: 'Something went wrong',
  };
  expect(formatErrorAsJSON(genericError)).toEqual(expectedOutput);
});

it('should format a not found error with name and message', () => {
  const notFoundError = {
    name: 'NotFoundError',
    message: 'Resource not found',
  };
  const expectedOutput = {
    name: 'NotFoundError',
    message: 'Resource not found',
  };
  expect(formatErrorAsJSON(notFoundError)).toEqual(expectedOutput);
});

it('should format a bad request error with name and message', () => {
  const badRequestError = {
    name: 'BadRequestError',
    message: 'Invalid request',
  };
  const expectedOutput = {
    name: 'BadRequestError',
    message: 'Invalid request',
  };
  expect(formatErrorAsJSON(badRequestError)).toEqual(expectedOutput);
});

it('should format an unauthorized error with name and message', () => {
  const unauthorizedError = {
    name: 'UnauthorizedError',
    message: 'Access denied',
  };
  const expectedOutput = {
    name: 'UnauthorizedError',
    message: 'Access denied',
  };
  expect(formatErrorAsJSON(unauthorizedError)).toEqual(expectedOutput);
});
    };
    const expectedOutput = {
      name: 'NotFoundError',
      message: 'Resource not found',
    };
    expect(formatErrorAsJSON(notFoundError)).toEqual(expectedOutput);
  });

  it('should format a bad request error with name and message', () => {
    const badRequestError = {
      name: 'BadRequestError',
      message: 'Invalid request',
    };
    const expectedOutput = {
      name: 'BadRequestError',
      message: 'Invalid request',
    };
    expect(formatErrorAsJSON(badRequestError)).toEqual(expectedOutput);
  });

  it('should format an unauthorized error with name and message', () => {
    const unauthorizedError = {
      name: 'UnauthorizedError',
      message: 'Access denied',
    };
    const expectedOutput = {
      name: 'UnauthorizedError',
      message: 'Access denied',
    };
    expect(formatErrorAsJSON(unauthorizedError)).toEqual(expectedOutput);
  });

  it('should format a custom error with name and message', () => {
    const customError = {
      name: 'CustomError',
      message: 'Custom error message',
    };
    const expectedOutput = {
      name: 'CustomError',
      message: 'Custom error message',
    };
    expect(formatErrorAsJSON(customError)).toEqual(expectedOutput);
  });

  it('should return null for null input', () => {
    expect(formatErrorAsJSON(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(formatErrorAsJSON(undefined)).toBeNull();
  });

  it('should format a validation error with multiple details', () => {
    const validationError = {
      code: 'VALIDATION',
      error: {
        all: [
          {
            path: ['username'],
            message: 'Username is required',
          },
          {
            path: ['password'],
            message: 'Password must be at least 8 characters long',
          },
        ],
      },
    };
    const expectedOutput = {
      code: 'VALIDATION',
      errors: [
        {
          path: ['username'],
          message: 'Username is required',
        },
        {
          path: ['password'],
          message: 'Password must be at least 8 characters long',
        },
      ],
    };
    expect(formatErrorAsJSON(validationError)).toEqual(expectedOutput);
  });

  it('should format a validation error with a single detail', () => {
    const validationError = {
      code: 'VALIDATION',
      error: {
        all: [
          {
            path: ['email'],
            message: 'Email is invalid',
          },
        ],
      },
    };
    const expectedOutput = {
      code: 'VALIDATION',
      errors: [
        {
          path: ['email'],
          message: 'Email is invalid',
        },
      ],
    };
    expect(formatErrorAsJSON(validationError)).toEqual(expectedOutput);
  });

  it('should format a validation error with no details', () => {
    const validationError = {
      code: 'VALIDATION',
      error: {
        all: [],
      },
    };
    const expectedOutput = {
      code: 'VALIDATION',
      errors: [],
    };
    expect(formatErrorAsJSON(validationError)).toEqual(expectedOutput);
  });
    expect(formatErrorAsJSON(undefined)).toBeNull();
  });
});
it('should format an unknown error correctly', () => {
  const unknownError = {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred'
  };
  const formattedError = formatErrorAsJSON(unknownError);
  expect(formattedError).toEqual({
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred'
  });
});
            {
              path: ['user', 'name'],
              message: 'Name is required',
            },
            {
              path: ['user', 'email'],
              message: 'Email must be valid',
            },
          ],
        },
      };
      const expectedOutput = {
        code: 'VALIDATION',
        errors: [
          {
            path: ['user', 'name'],
            message: 'Name is required',
          },
          {
            path: ['user', 'email'],
            message: 'Email must be valid',
          },
        ],
      };
      expect(formatErrorAsJSON(nestedValidationError)).toEqual(expectedOutput);
    });
  it('should format an empty error object correctly', () => {
    const emptyError = {};
    const formattedError = formatErrorAsJSON(emptyError);
    expect(formattedError).toEqual({
  it('should format a validation error with an empty `all` property correctly', () => {
    const missingAllPropertyValidationError = {
      code: 'VALIDATION',
      error: {
        all: []
      }
    };
    const formattedError = formatErrorAsJSON(missingAllPropertyValidationError);
    expect(formattedError).toEqual({
      code: 'VALIDATION',
      errors: []
    });
  });

  it('should format a validation error with a malformed `all` property correctly', () => {
    const malformedStructureError = {
      code: 'VALIDATION',
      error: {
        all: 'not an array'
      }
    };
    const formattedError = formatErrorAsJSON(malformedStructureError);
    expect(formattedError).toEqual({
      code: 'VALIDATION',
      errors: []
    });
  });
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