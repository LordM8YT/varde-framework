'use strict';

class RateLimiter {
  constructor(clock = () => Date.now()) {
    this.clock = clock;
    this.buckets = new Map();
  }

  allow(key, limit, windowMs) {
    const now = this.clock();
    const cutoff = now - windowMs;
    const existing = this.buckets.get(key) || [];
    const recent = existing.filter((timestamp) => timestamp > cutoff);

    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      return false;
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  clearPrefix(prefix) {
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) {
        this.buckets.delete(key);
      }
    }
  }
}

module.exports = {
  RateLimiter,
};
