'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAmount,
  validateCharacterInput,
  validateMetadata,
  validatePosition,
} = require('../server/validation');

test('character input is normalized without losing Unicode names', () => {
  assert.deepEqual(
    validateCharacterInput(
      {
        slot: 2,
        firstName: '  Åse  ',
        lastName: "O'Connor",
        birthDate: '1994-02-28',
        gender: 'unspecified',
        nationality: 'Norwegian',
      },
      4,
    ),
    {
      slot: 2,
      firstName: 'Åse',
      lastName: "O'Connor",
      birthDate: '1994-02-28',
      gender: 'unspecified',
      nationality: 'Norwegian',
    },
  );
});

test('invalid calendar dates and out-of-range slots are rejected', () => {
  assert.throws(
    () =>
      validateCharacterInput(
        {
          slot: 0,
          firstName: 'Test',
          lastName: 'Person',
          birthDate: '1990-01-01',
        },
        4,
      ),
    { code: 'VALIDATION_ERROR' },
  );
  assert.throws(
    () =>
      validateCharacterInput(
        {
          slot: 1,
          firstName: 'Test',
          lastName: 'Person',
          birthDate: '2026-02-30',
        },
        4,
    ),
    { code: 'VALIDATION_ERROR' },
  );
  assert.throws(
    () =>
      validateCharacterInput(
        {
          slot: 1,
          firstName: 'Test',
          lastName: 'Person',
          birthDate: '2999-01-01',
        },
        4,
      ),
    { code: 'VALIDATION_ERROR' },
  );
});

test('positions, money, and metadata are bounded', () => {
  assert.deepEqual(validatePosition({ x: 1, y: 2, z: 3, heading: -10 }), {
    x: 1,
    y: 2,
    z: 3,
    heading: 350,
  });
  assert.equal(validateAmount(500), 500);
  assert.deepEqual(validateMetadata('licenses.driving', { granted: true }), {
    granted: true,
  });

  assert.throws(
    () => validatePosition({ x: Infinity, y: 2, z: 3, heading: 0 }),
    { code: 'VALIDATION_ERROR' },
  );
  assert.throws(() => validateAmount(-1), { code: 'VALIDATION_ERROR' });
  assert.throws(() => validateMetadata('__proto__', true), {
    code: 'VALIDATION_ERROR',
  });
});
