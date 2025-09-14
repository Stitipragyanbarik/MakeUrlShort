import { cacheService } from '../config/redis.config.js';
import { getShortUrl as getShortUrlFromDB, saveShortUrl } from '../dao/shortUrl.js';

// Improved Circuit breaker for Redis operations - Less sensitive
class CircuitBreaker {
  constructor(failureThreshold = 10, recoveryTimeout = 60000) { // Increased threshold and timeout
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.successCount = 0; // Track successes in HALF_OPEN state
    this.minSuccessCount = 3; // Require 3 successes to close circuit
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - Redis temporarily unavailable');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.minSuccessCount) {
        this.state = 'CLOSED';
        console.log('✅ Circuit breaker CLOSED - Redis recovered');
      }
    } else {
      this.state = 'CLOSED';
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log('❌ Circuit breaker OPEN - Redis failures exceeded threshold');
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      successCount: this.successCount
    };
  }
}

const redisCircuitBreaker = new CircuitBreaker();

// Performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      redisErrors: 0,
      dbFallbacks: 0,
      avgResponseTime: 0,
      totalRequests: 0
    };
    this.responseTimes = [];
  }

  recordCacheHit() {
    this.metrics.cacheHits++;
    this.metrics.totalRequests++;
  }

  recordCacheMiss() {
    this.metrics.cacheMisses++;
    this.metrics.totalRequests++;
  }

  recordRedisError() {
    this.metrics.redisErrors++;
  }

  recordDbFallback() {
    this.metrics.dbFallbacks++;
  }

  recordResponseTime(time) {
    this.responseTimes.push(time);
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift(); // Keep only last 100 measurements
    }
    this.metrics.avgResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.totalRequests > 0 ? (this.metrics.cacheHits / this.metrics.totalRequests) * 100 : 0,
      errorRate: this.metrics.totalRequests > 0 ? (this.metrics.redisErrors / this.metrics.totalRequests) * 100 : 0
    };
  }

  reset() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      redisErrors: 0,
      dbFallbacks: 0,
      avgResponseTime: 0,
      totalRequests: 0
    };
    this.responseTimes = [];
  }
}

const performanceMonitor = new PerformanceMonitor();

// Cache keys
const CACHE_KEYS = {
  SHORT_URL: (shortUrl) => `url:${shortUrl}`,
  POPULAR_URLS: 'popular:urls',
  ANALYTICS: (shortUrl) => `analytics:${shortUrl}`,
  DAILY_CLICKS: (shortUrl, date) => `clicks:${shortUrl}:${date}`,
  RATE_LIMIT: (ip) => `rate:${ip}`
};

const CACHE_TTL = {
  SHORT_URL: 600, // 10 minutes (reduced for better cache turnover at 150 req/sec)
  POPULAR_URLS: 300, // 5 minutes
  ANALYTICS: 600, // 10 minutes (reduced for memory efficiency)
  DAILY_CLICKS: 86400, // 24 hours
  RATE_LIMIT: 1 // 1 second
};

export const urlCacheService = {
  // Get URL with caching - Optimized for high concurrency
  async getShortUrl(shortUrl) {
    const startTime = Date.now();
    try {
      // Try cache first with circuit breaker protection
      const cacheKey = CACHE_KEYS.SHORT_URL(shortUrl);
      let urlData = await redisCircuitBreaker.execute(async () => {
        return await Promise.race([
          cacheService.get(cacheKey),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cache timeout')), 2000))
        ]);
      });

      if (urlData) {
        performanceMonitor.recordCacheHit();
        // Increment click count asynchronously (fire and forget)
        this.incrementClicks(shortUrl).catch(err => console.error('Click increment failed:', err));
        performanceMonitor.recordResponseTime(Date.now() - startTime);
        return urlData;
      }

      performanceMonitor.recordCacheMiss();
      console.log(`Cache miss for short URL: ${shortUrl}`);

      // Cache miss - get from database with increased timeout
      const dbPromise = getShortUrlFromDB(shortUrl);
      urlData = await Promise.race([
        dbPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 3000))
      ]);

      if (urlData) {
        // Cache asynchronously (fire and forget)
        cacheService.set(cacheKey, urlData, CACHE_TTL.SHORT_URL).catch(err =>
          console.error('Cache set failed:', err)
        );
      }

      performanceMonitor.recordResponseTime(Date.now() - startTime);
      return urlData;
    } catch (error) {
      performanceMonitor.recordRedisError();
      console.error('Error in getShortUrl cache service:', error.message);
      // Fallback to database with reasonable timeout
      try {
        performanceMonitor.recordDbFallback();
        console.log(`Falling back to database for short URL: ${shortUrl}`);
        const fallbackResult = await Promise.race([
          getShortUrlFromDB(shortUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fallback timeout')), 2500))
        ]);
        performanceMonitor.recordResponseTime(Date.now() - startTime);
        return fallbackResult;
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError.message);
        // Graceful degradation: return null instead of throwing
        performanceMonitor.recordResponseTime(Date.now() - startTime);
        return null;
      }
    }
  },

  // Increment click count (async, non-blocking)
  async incrementClicks(shortUrl) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const clickKey = CACHE_KEYS.DAILY_CLICKS(shortUrl, today);
      
      // Increment daily clicks in Redis
      await cacheService.incr(clickKey, CACHE_TTL.DAILY_CLICKS);
      
      // Update analytics cache
      const analyticsKey = CACHE_KEYS.ANALYTICS(shortUrl);
      let analytics = await cacheService.get(analyticsKey) || { totalClicks: 0, dailyClicks: {} };
      
      analytics.totalClicks += 1;
      analytics.dailyClicks[today] = (analytics.dailyClicks[today] || 0) + 1;
      
      await cacheService.set(analyticsKey, analytics, CACHE_TTL.ANALYTICS);
      
    } catch (error) {
      console.error('Error incrementing clicks:', error);
    }
  },

  // Cache new URL
  async cacheNewUrl(shortUrl, urlData) {
    try {
      const cacheKey = CACHE_KEYS.SHORT_URL(shortUrl);
      await cacheService.set(cacheKey, urlData, CACHE_TTL.SHORT_URL);
      console.log(`✅ Cached new URL: ${shortUrl}`);
    } catch (error) {
      console.error('Error caching new URL:', error);
    }
  },

  // Get popular URLs
  async getPopularUrls(limit = 10) {
    try {
      const cacheKey = CACHE_KEYS.POPULAR_URLS;
      let popularUrls = await cacheService.get(cacheKey);
      
      if (!popularUrls) {
        // This would typically come from database aggregation
        // For now, return empty array
        popularUrls = [];
        await cacheService.set(cacheKey, popularUrls, CACHE_TTL.POPULAR_URLS);
      }
      
      return popularUrls;
    } catch (error) {
      console.error('Error getting popular URLs:', error);
      return [];
    }
  },

  // Rate limiting with token bucket to allow bursts while keeping sustained rate
  async checkRateLimit(ip, options = {}) {
    const {
      sustainedRps = 150,   // refill rate per second
      burstCapacity = 75,   // extra tokens allowed in bursts
    } = typeof options === 'number' ? { sustainedRps: options, burstCapacity: 75 } : options;

    try {
      const key = `tb:${ip}`;
      const now = Date.now();

      // Read bucket state
      const state = await cacheService.get(key) || { tokens: sustainedRps + burstCapacity, ts: now };

      // Refill tokens based on elapsed time
      const elapsedSec = Math.max(0, (now - state.ts) / 1000);
      let tokens = Math.min(
        sustainedRps + burstCapacity,
        state.tokens + elapsedSec * sustainedRps
      );

      let allowed = false;
      if (tokens >= 1) {
        tokens -= 1; // consume one token per request
        allowed = true;
      }

      // Save updated state with a TTL to auto-expire idle buckets
      const newState = { tokens, ts: now };
      // Keep key around for ~60s of inactivity
      await cacheService.set(key, newState, 60);

      // Estimated reset time (seconds until full)
      const resetSeconds = Math.ceil((sustainedRps + burstCapacity - tokens) / Math.max(1, sustainedRps));

      return {
        allowed,
        tokens,
        capacity: sustainedRps + burstCapacity,
        remaining: Math.floor(tokens),
        resetTime: now + resetSeconds * 1000,
      };
    } catch (error) {
      console.error('Error checking rate limit (token bucket):', error.message);
      // Allow on error to avoid blocking traffic
      return { allowed: true, tokens: sustainedRps, capacity: sustainedRps + burstCapacity, remaining: sustainedRps };
    }
  },

  // Clear cache for URL
  async clearUrlCache(shortUrl) {
    try {
      const cacheKey = CACHE_KEYS.SHORT_URL(shortUrl);
      await cacheService.del(cacheKey);
      console.log(`🗑️ Cleared cache for ${shortUrl}`);
    } catch (error) {
      console.error('Error clearing URL cache:', error);
    }
  },

  // Get analytics
  async getAnalytics(shortUrl) {
    try {
      const analyticsKey = CACHE_KEYS.ANALYTICS(shortUrl);
      return await cacheService.get(analyticsKey) || { totalClicks: 0, dailyClicks: {} };
    } catch (error) {
      console.error('Error getting analytics:', error);
      return { totalClicks: 0, dailyClicks: {} };
    }
  },

  // Health check for Redis and cache service
  async healthCheck() {
    try {
      const redisHealth = await cacheService.get('health:check') !== null ?
        { status: 'healthy', latency: await cacheService.ping() } :
        { status: 'degraded', message: 'Cache not responding' };

      const circuitBreakerState = redisCircuitBreaker.getState();
      const metrics = performanceMonitor.getMetrics();

      return {
        redis: redisHealth,
        circuitBreaker: circuitBreakerState,
        performance: metrics,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  },

  // Get performance metrics
  getPerformanceMetrics() {
    return performanceMonitor.getMetrics();
  },

  // Reset performance metrics
  resetPerformanceMetrics() {
    performanceMonitor.reset();
    return { message: 'Performance metrics reset successfully' };
  }
};
