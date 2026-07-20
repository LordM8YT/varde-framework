'use strict';

class JobsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JobsError';
    this.code = code;
  }
}

function jobsError(code, message) {
  return new JobsError(code, message);
}

module.exports = {
  JobsError,
  jobsError,
};
