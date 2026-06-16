// Test probe 1: Timing - read customError/message/payload BEFORE allowUnsafeValidationDetails is set
// Test probe 2: own-enumerable parity
// Test probe 3: Schema error callback fires once (memoized)
// Test probe 4: Setting allowUnsafeValidationDetails on non-object throws under ESM strict mode

import { ValidationError, isProduction } from './dist/error.js';

console.log('=== TEST 1: Timing - Stale Gate Read ===');
const errors1 = [{ instancePath: '/x', message: 'expected number' }];
const ve1 = new ValidationError('test', { x: 1 }, errors1);
console.log('Before setting flag - customError:', ve1.customError); 
console.log('Before setting flag - message:', ve1.message); 
ve1.allowUnsafeValidationDetails = true;
console.log('After setting flag - customError (should be same, memoized):', ve1.customError); 
console.log('After setting flag - message (should be same, memoized):', ve1.message);

console.log('\n=== TEST 2: Own-Enumerable Parity ===');
const schema = {
  properties: {
    x: { type: 'number', error: 'x must be a number' }
  }
};
const ve2 = new ValidationError('body', { x: 'str' }, [{ instancePath: '/x', message: 'expected number' }], schema);
ve2.allowUnsafeValidationDetails = true;
const keys = Object.keys(ve2);
const enumerable = {};
for (const k of keys) enumerable[k] = true;
console.log('Own enumerable keys:', keys);
console.log('errors enumerable?', enumerable.errors ? 'true - CORRECT' : 'false - REGRESSION');
console.log('customError enumerable?', enumerable.customError ? 'true - CORRECT' : 'false - REGRESSION');
console.log('message enumerable?', enumerable.message ? 'true - REGRESSION' : 'false - CORRECT');

console.log('\n=== TEST 3: Schema Error Callback (Memoized Resolve) ===');
let callCount = 0;
const schema3 = {
  properties: {
    y: {
      type: 'string',
      error: (err) => {
        callCount++;
        err.message = `Custom: ${callCount}`;
        return err;
      }
    }
  }
};
const ve3 = new ValidationError('body', { y: 123 }, [{ instancePath: '/y', message: 'expected string' }], schema3);
ve3.allowUnsafeValidationDetails = true;
console.log('First message read:', ve3.message);
console.log('Second message read:', ve3.message);
console.log('Call count (should be 1):', callCount, callCount === 1 ? 'PASS' : 'REGRESSION');

console.log('\n=== TEST 4: Setting Flag on Thrown Non-Object Value ===');
try {
  // Simulate catch point guard: e?.code === 'VALIDATION' should not throw on string/number
  const thrownStr = 'error string';
  if (thrownStr?.code === 'VALIDATION') {
    thrownStr.allowUnsafeValidationDetails = true; // should not execute
  }
  console.log('String guard: OK (did not execute assignment)');
} catch (e) {
  console.log('String guard: ERROR -', e.message);
}

try {
  const thrownNum = 42;
  if (thrownNum?.code === 'VALIDATION') {
    thrownNum.allowUnsafeValidationDetails = true; // should not execute
  }
  console.log('Number guard: OK (did not execute assignment)');
} catch (e) {
  console.log('Number guard: ERROR -', e.message);
}

try {
  // Actual ValidationError object
  const ve4 = new ValidationError('test', 'value', []);
  if (ve4?.code === 'VALIDATION') {
    ve4.allowUnsafeValidationDetails = true; // SHOULD execute
  }
  console.log('ValidationError guard: OK, flag set =', ve4.allowUnsafeValidationDetails);
} catch (e) {
  console.log('ValidationError guard: ERROR -', e.message);
}

console.log('\n=== TEST 5: Lazy vs Eager Parity ===');
// Old: eager array errors
// New: thunk wrapping
const ve5eager = new ValidationError('body', { a: 1 }, [{ message: 'error' }]);
const ve5lazy = new ValidationError('body', { a: 1 }, () => [{ message: 'error' }]);
console.log('Eager errors:', ve5eager.errors);
console.log('Lazy errors:', ve5lazy.errors);
console.log('Parity OK:', JSON.stringify(ve5eager.errors) === JSON.stringify(ve5lazy.errors) ? 'PASS' : 'REGRESSION');

console.log('\n=== TEST 6: Production Gate (isProduction check) ===');
console.log('Current isProduction():', isProduction());
const ve6 = new ValidationError('body', { x: 'bad' }, [{ instancePath: '/x', message: 'expected number' }]);
const payload1 = ve6.payload;
console.log('Payload keys (before allowUnsafe):', Object.keys(payload1));
console.log('Has "errors" in payload?', 'errors' in payload1 ? 'yes (normal)' : 'no (production?)');
ve6.allowUnsafeValidationDetails = true;
const payload2 = ve6.payload;
console.log('Payload keys (after allowUnsafe):', Object.keys(payload2));
console.log('Has "errors" in payload?', 'errors' in payload2 ? 'yes (correct)' : 'no (REGRESSION)');

console.log('\n=== TEST 7: toResponse() with customError ===');
const schema7 = {
  properties: {
    z: { type: 'string', error: 'please provide a valid string' }
  }
};
const ve7 = new ValidationError('body', { z: 42 }, [{ instancePath: '/z', message: 'expected string' }], schema7);
ve7.allowUnsafeValidationDetails = true;
const resp = ve7.toResponse();
console.log('toResponse() type:', resp.constructor.name);
console.log('toResponse() status:', resp.status);
const respBody = await resp.text();
console.log('toResponse() body:', respBody);
console.log('Contains schema details?', respBody.includes('expected') ? 'yes' : 'no (may depend on production)');

