'use strict';

const { FrameworkError, frameworkError } = require('./errors');
const { RateLimiter } = require('./rate-limiter');

class RpcServer {
  constructor(runtime) {
    this.runtime = runtime;
    this.handlers = new Map();
    this.rateLimiter = new RateLimiter();
  }

  register(method, handler, options = {}) {
    if (this.handlers.has(method)) {
      throw new Error(`RPC method ${method} is already registered`);
    }
    this.handlers.set(method, {
      handler,
      limit: options.limit || 20,
      windowMs: options.windowMs || 10_000,
    });
  }

  handle(source, requestId, method, payload) {
    const playerSource = Number(source);
    const responseId = String(requestId || '');

    try {
      if (
        !Number.isSafeInteger(playerSource) ||
        playerSource <= 0 ||
        !/^[a-zA-Z0-9:_-]{1,64}$/.test(responseId)
      ) {
        throw frameworkError('RPC_INVALID', 'invalid RPC envelope');
      }
      if (typeof method !== 'string' || method.length > 64) {
        throw frameworkError('RPC_INVALID', 'invalid RPC method');
      }

      const registration = this.handlers.get(method);
      if (!registration) {
        throw frameworkError('RPC_NOT_FOUND', `unknown RPC method ${method}`);
      }

      let payloadSize;
      try {
        payloadSize = JSON.stringify(payload ?? {}).length;
      } catch {
        throw frameworkError('RPC_INVALID', 'RPC payload must be JSON serializable');
      }
      if (payloadSize > 32_768) {
        throw frameworkError('RPC_TOO_LARGE', 'RPC payload exceeds 32 KiB');
      }

      const rateKey = `${playerSource}:${method}`;
      if (
        !this.rateLimiter.allow(
          rateKey,
          registration.limit,
          registration.windowMs,
        )
      ) {
        throw frameworkError('RATE_LIMITED', 'too many requests');
      }

      const data = registration.handler(playerSource, payload ?? {});
      this.reply(playerSource, responseId, {
        ok: true,
        data: data === undefined ? null : data,
      });
    } catch (error) {
      if (error instanceof FrameworkError) {
        this.reply(playerSource, responseId, {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }

      this.runtime.log('error', error?.stack || String(error));
      this.reply(playerSource, responseId, {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'the server could not complete the request',
        },
      });
    }
  }

  reply(source, requestId, response) {
    if (Number.isSafeInteger(source) && source > 0 && requestId) {
      this.runtime.emitClient(
        source,
        'varde:client:rpcResponse',
        requestId,
        response,
      );
    }
  }

  drop(source) {
    this.rateLimiter.clearPrefix(`${Number(source)}:`);
  }
}

module.exports = {
  RpcServer,
};
