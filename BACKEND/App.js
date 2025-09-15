 import express from "express";
import { nanoid } from "nanoid";
import dotenv from "dotenv";
import connectDB from "./src/config/mongo.config.js";
import redis from "./src/config/redis.config.js";
import urlSchema from "./src/models/shorturlSchema.js";
import short_url from "./src/routes/shortUrlRoutes.js";
import { redirectFromShortUrl } from "./src/controller/shortUrlController.js";
import { errorHandler } from "./src/utils/errorHandler.js";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimiter } from "./src/middleware/rateLimiter.js";
import os from "os";
import mongoose from "mongoose";

dotenv.config();

const app = express();
app.set('trust proxy', true);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Custom Redis-based rate limiter for 150 req/sec

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Compression middleware for better performance
app.use(compression());

// CORS middleware - must be before other middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://make-url-short.vercel.app', 'http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Simplified logging middleware for high load (remove detailed logging)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('tiny')); // Minimal logging in production
}

// Body parsing middleware - Optimized for high throughput
app.use(express.json({ limit: '1mb' })); // Reduced limit for better performance
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // Disabled extended for performance

// Apply rate limiter early to avoid queueing and reduce 429 under burst
app.use(rateLimiter({
  windowMs: 1000, // 1 second window
  max: 150, // sustained per-IP rate tuned for target load
  burstCapacity: 300, // allow bursts up to 2x sustained rate
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
}));

// Global rate limiter to handle IP rotation in load tests
let globalRequestCount = 0;
let globalWindowStart = Date.now();
const GLOBAL_RATE_LIMIT = 180; // Tuned for 150 req/sec target with buffer
const GLOBAL_WINDOW_MS = 1000;

app.use((req, res, next) => {
  const now = Date.now();
  if (now - globalWindowStart >= GLOBAL_WINDOW_MS) {
    globalRequestCount = 0;
    globalWindowStart = now;
  }

  if (globalRequestCount >= GLOBAL_RATE_LIMIT) {
    return res.status(429).json({
      error: "Global rate limit exceeded, please try again later.",
      retryAfter: Math.ceil((globalWindowStart + GLOBAL_WINDOW_MS - now) / 1000)
    });
  }

  globalRequestCount++;
  next();
});

// Optimized connection limiting middleware to prevent server overload
let activeConnections = 0;
const MAX_CONNECTIONS = 5000; // Tuned for 150 req/sec target
let connectionRejections = 0;

app.use((req, res, next) => {
  activeConnections++;
  res.on('finish', () => {
    activeConnections--;
  });
  res.on('close', () => {
    activeConnections--;
  });

  if (activeConnections > MAX_CONNECTIONS) {
    connectionRejections++;
    console.warn(`Connection rejected: activeConnections=${activeConnections}, max=${MAX_CONNECTIONS}, total rejections=${connectionRejections}`);
    res.status(503).json({
      error: 'Server busy, please try again later',
      retryAfter: 1,
      activeConnections,
      maxConnections: MAX_CONNECTIONS
    });
    return;
  }

  next();
});

// Improved request queuing for high load with better load distribution
const requestQueue = [];
const MAX_QUEUE_SIZE = 5000; // Tuned for 150 req/sec target
let processingRequests = 0;
const MAX_CONCURRENT_REQUESTS = 1000; // Tuned for 150 req/sec target
let queueRejections = 0;

// Ensure queued requests also attach finish/close listeners and decrement counters
const processNextQueuedRequest = () => {
  if (requestQueue.length === 0) return;
  if (processingRequests >= MAX_CONCURRENT_REQUESTS) return;

  const { req, res, next } = requestQueue.shift();
  processingRequests++;

  const onDone = () => {
    res.removeListener('finish', onDone);
    res.removeListener('close', onDone);
    processingRequests--;
    processNextQueuedRequest();
  };

  res.on('finish', onDone);
  res.on('close', onDone);
  next();
};

app.use((req, res, next) => {
  if (processingRequests >= MAX_CONCURRENT_REQUESTS) {
    if (requestQueue.length >= MAX_QUEUE_SIZE) {
      queueRejections++;
      console.warn(`Queue rejected: queueSize=${requestQueue.length}, maxQueueSize=${MAX_QUEUE_SIZE}, total rejections=${queueRejections}`);
      res.status(503).json({
        error: 'Server overloaded, please try again later',
        retryAfter: 2,
        queueSize: requestQueue.length,
        maxQueueSize: MAX_QUEUE_SIZE
      });
      return;
    }

    // Add request to queue with priority (health checks get priority)
    const isHealthCheck = req.path === '/health' || req.path === '/metrics';
    if (isHealthCheck) {
      requestQueue.unshift({ req, res, next }); // Add to front for priority
    } else {
      requestQueue.push({ req, res, next });
    }
    // Try processing in case capacity just freed
    processNextQueuedRequest();
    return;
  }

  processingRequests++;
  const onDone = () => {
    res.removeListener('finish', onDone);
    res.removeListener('close', onDone);
    processingRequests--;
    processNextQueuedRequest();
  };
  res.on('finish', onDone);
  res.on('close', onDone);

  next();
});

// Rate limiter moved earlier in the chain to short-circuit work

// Health check endpoint for load balancer
app.get('/health', async (req, res) => {
  try {
    // Check Redis connection
    await redis.ping();
    // Check MongoDB connection
    const mongoState = mongoose.connection.readyState;
    const { checkMongoHealth } = await import('./src/config/mongo.config.js');
    const mongoHealth = await checkMongoHealth();

    // Determine overall health
    const isHealthy = mongoHealth.status === 'healthy' && mongoState === 1;

    const healthResponse = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      redis: 'connected',
      mongodb: mongoHealth,
      version: process.env.npm_package_version || '1.0.0',
      connections: {
        active: activeConnections,
        max: MAX_CONNECTIONS,
        processing: processingRequests,
        maxConcurrent: MAX_CONCURRENT_REQUESTS,
        queued: requestQueue.length,
        maxQueue: MAX_QUEUE_SIZE
      },
      system: {
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        // Use imported 'os' module; avoid require in ESM
        loadAverage: process.platform !== 'win32' ? (os.loadavg ? os.loadavg() : 'N/A') : 'N/A'
      }
    };

    res.status(isHealthy ? 200 : 503).json(healthResponse);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
      connections: {
        active: activeConnections,
        processing: processingRequests,
        queued: requestQueue.length
      }
    });
  }
});

// Performance metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const { urlCacheService } = await import('./src/services/cacheService.js');

    const cacheHealth = await urlCacheService.healthCheck();
    const systemMetrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      connections: {
        active: activeConnections,
        processing: processingRequests,
        queued: requestQueue.length
      }
    };

    res.status(200).json({
      timestamp: new Date().toISOString(),
      system: systemMetrics,
      cache: cacheHealth,
      circuitBreaker: cacheHealth.circuitBreaker,
      performance: cacheHealth.performance
    });
  } catch (error) {
    console.error('Metrics endpoint error:', error);
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Reset performance metrics endpoint
app.post('/metrics/reset', async (req, res) => {
  try {
    const { urlCacheService } = await import('./src/services/cacheService.js');

    const result = urlCacheService.resetPerformanceMetrics();
    res.status(200).json({
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Metrics reset error:', error);
    res.status(500).json({
      error: 'Failed to reset metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});


// Homepage route for root URL
app.get('/', (req, res) => res.send('URL Shortener API is running!'));

// API routes
app.use("/api/create", short_url);

// Redirect route
app.get("/:id", redirectFromShortUrl);

// Error handling middleware
app.use(errorHandler);

// Cluster logic removed for external load balancing
const startServer = async (port) => {
  const server = app.listen(port, '0.0.0.0', async () => {
    try {
      await connectDB();
      console.log(`🚀 Server started on http://0.0.0.0:${port}`);
      console.log(`📊 Health check available at http://0.0.0.0:${port}/health`);
      console.log(`🔄 Rate limiting: 150 requests per second per IP`);
    } catch (err) {
      console.error('Failed to connect DB on startup:', err);
    }

    // Increase max connections and tune keep-alive timeout for high concurrency
    server.maxConnections = MAX_CONNECTIONS; // Tuned for 150 req/sec
    server.keepAliveTimeout = 5000; // 5 seconds
    server.headersTimeout = 7000; // 7 seconds (should be > keepAliveTimeout)

  }).on('error', (err) => {
    console.error('HTTP server failed to start:', err);
    process.exit(1);
  });

  return server;
};

const server = startServer(PORT);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server terminated');
    process.exit(0);
  });
});

export default app;
