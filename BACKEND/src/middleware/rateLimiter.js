import { urlCacheService } from '../services/cacheService.js';

export const rateLimiter = (options = {}) => {
  const {
    windowMs = 1000, // 1 second
    max = 300, // Set to 300 requests/sec per IP for 278/sec target
    message = 'Too many requests from this IP, please try again later.',
    standardHeaders = true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders = false, // Disable the `X-RateLimit-*` headers
  } = options;

  return async (req, res, next) => {
    try {
      const xff = req.headers['x-forwarded-for'];
      const clientIp = (Array.isArray(xff) ? xff[0] : (xff?.split(',')[0]?.trim())) || req.ip || req.connection.remoteAddress || 'unknown';

      const rateLimit = await urlCacheService.checkRateLimit(clientIp, { sustainedRps: max, burstCapacity: options.burstCapacity ?? 800 });

      if (standardHeaders) {
        res.set({
          'RateLimit-Limit': max,
          'RateLimit-Remaining': rateLimit.remaining,
          'RateLimit-Reset': Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
        });
      }

      if (legacyHeaders) {
        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': rateLimit.remaining,
          'X-RateLimit-Reset': Math.ceil(rateLimit.resetTime / 1000),
        });
      }

      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: message,
          retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
        });
      }

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      // If rate limiter fails, allow the request to continue
      next();
    }
  };
};
