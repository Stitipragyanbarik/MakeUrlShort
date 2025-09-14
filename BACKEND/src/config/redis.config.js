import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Redis configuration optimized for high-throughput scalability
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryDelayOnFailover: 100, // Slightly longer for stability
  maxRetriesPerRequest: 3, // Enable retries for reliability
  lazyConnect: true, // Changed to lazyConnect to avoid startup failures
  keepAlive: 30000,
  connectTimeout: 5000, // Increased to 5s for better connection stability
  commandTimeout: 2000, // Increased to 2s for complex operations
  enableOfflineQueue: true, // Enable to queue commands when Redis is down
  offlineQueueMaxLength: 1000, // Limit queue size to prevent memory issues
  autoResendUnfulfilledCommands: true, // Enable to resend failed commands
  enableReadyCheck: true, // Enable ready check for reliability
  dropBufferSupport: false, // Enable buffer for better performance
  connectionName: 'url-shortener-scaled', // Updated connection name
  maxRetriesPerRequest: 3, // Retry failed requests
  retryDelayOnFailover: 100, // Delay between retries
  // Removed incorrect pooling options - ioredis handles connections internally
  // For Redis Cluster (uncomment when using cluster)
  // cluster: [
  //   { host: '127.0.0.1', port: 7001 },
  //   { host: '127.0.0.1', port: 7002 },
  //   { host: '127.0.0.1', port: 7003 },
  // ],
  // For Redis Sentinel (uncomment when using sentinel)
  // sentinels: [
  //   { host: '127.0.0.1', port: 26379 },
  //   { host: '127.0.0.1', port: 26380 },
  //   { host: '127.0.0.1', port: 26381 },
  // ],
  // name: 'mymaster',
};

// Create Redis client
const redis = new Redis(redisConfig);

// Track Redis availability
let redisAvailable = false;

// Redis event handlers
redis.on('connect', () => {
  redisAvailable = true;
  console.log('✅ Redis connected successfully');

});

redis.on('ready', () => {
  redisAvailable = true;
  console.log('🚀 Redis is ready to accept commands');
});

redis.on('error', (err) => {
  redisAvailable = false;
  console.error('❌ Redis connection error:', err);
    // Handle specific error codes
  if (err.code === 'ECONNREFUSED') {
    console.error(' Redis connection refused. ioredis will retry automatically...');

  } else if (err.code === 'ECONNRESET') {
    console.error(' Redis connection reset. ioredis will retry automatically...');

  } else {
    console.error(' Unknown Redis error:', err);
    // Consider sending an alert to the development team
  }
});

redis.on('close', () => {
  redisAvailable = false;
  console.log('🔌 Redis connection closed');
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});

// Health check function
export const checkRedisHealth = async () => {
  try {
    await redis.ping();
    return { status: 'healthy', latency: await redis.ping() };
  } catch (error) {
    console.error('Redis health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

// Cache utility functions with Redis availability check
export const cacheService = {
  // Ping Redis to check connectivity
  async ping() {
    if (!redisAvailable) return null;
    try {
      return await redis.ping(); // returns 'PONG' on success
    } catch (error) {
      console.error('Cache ping error:', error);
      return null;
    }
  },

  // Get cached data
  async get(key) {
    if (!redisAvailable) return null;
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },

  // Set cache with TTL (Time To Live)
  async set(key, value, ttlSeconds = 3600) {
    if (!redisAvailable) return false;
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  },

  // Delete cache
  async del(key) {
    if (!redisAvailable) return false;
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  },

  // Increment counter (for analytics)
  async incr(key, ttlSeconds = 86400) {
    if (!redisAvailable) return 0;
    try {
      const result = await redis.incr(key);
      if (result === 1) {
        await redis.expire(key, ttlSeconds);
      }
      return result;
    } catch (error) {
      console.error('Cache increment error:', error);
      return 0;
    }
  },

  // Get multiple keys
  async mget(keys) {
    if (!redisAvailable) return [];
    try {
      const values = await redis.mget(keys);
      return values.map(val => val ? JSON.parse(val) : null);
    } catch (error) {
      console.error('Cache mget error:', error);
      return [];
    }
  },

  // Check if key existsclear

  async exists(key) {
    if (!redisAvailable) return false;
    try {
      return await redis.exists(key);
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }
};

export default redis;
