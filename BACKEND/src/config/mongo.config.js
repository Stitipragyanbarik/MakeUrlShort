import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Connection health monitoring
let connectionHealth = {
    isHealthy: false,
    lastCheck: Date.now(),
    consecutiveFailures: 0,
    totalConnections: 0,
    activeConnections: 0
};

const connectDB = async () => {
    const maxRetries = 10; // Increased retries for better resilience
    let retries = 0;

    // Optimized connection options for high concurrency with stability
    const options = {
        maxPoolSize: 200, // Optimized pool size for high load capacity
        minPoolSize: 20,  // Minimum connections for stability
        maxIdleTimeMS: 60000, // Increased idle time for better connection reuse
        serverSelectionTimeoutMS: 30000, // Increased for better stability under load
        socketTimeoutMS: 45000, // Increased for complex operations
        connectTimeoutMS: 30000, // Increased for reliable connection establishment
        bufferCommands: false,
        family: 4,
        heartbeatFrequencyMS: 10000, // Balanced heartbeat frequency
        retryWrites: true,
        retryReads: true,
        readPreference: 'primaryPreferred', // Better read distribution
        writeConcern: { w: 1, j: false, wtimeout: 10000 }, // Balanced write timeout
        // Add connection pool monitoring
        monitorCommands: true,
        // Additional options for high load
        maxConnecting: 10, // Limit concurrent connection attempts
    };

    const connectWithRetry = async () => {
        try {
            const conn = await mongoose.connect(process.env.MONGO_URI, options);
            console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
            console.log(`📊 MongoDB Connection State: ${conn.connection.readyState}`);
            console.log(`🔗 Connection Pool Size: ${options.maxPoolSize}`);

            connectionHealth.isHealthy = true;
            connectionHealth.lastCheck = Date.now();
            connectionHealth.consecutiveFailures = 0;

            // Enhanced connection event handlers
            mongoose.connection.on('error', (err) => {
                console.error('❌ MongoDB connection error:', err.message);
                connectionHealth.isHealthy = false;
                connectionHealth.consecutiveFailures++;
                connectionHealth.lastCheck = Date.now();
            });

            mongoose.connection.on('disconnected', () => {
                console.log('🔌 MongoDB disconnected');
                connectionHealth.isHealthy = false;
                connectionHealth.lastCheck = Date.now();
            });

            mongoose.connection.on('reconnected', () => {
                console.log('🔄 MongoDB reconnected');
                connectionHealth.isHealthy = true;
                connectionHealth.consecutiveFailures = 0;
                connectionHealth.lastCheck = Date.now();
            });

            mongoose.connection.on('reconnectFailed', () => {
                console.error('❌ MongoDB reconnection failed');
                connectionHealth.consecutiveFailures++;
            });

            // Connection pool pre-warming for better performance under load
            const warmUpConnections = async () => {
                try {
                    // Pre-warm connections by making lightweight queries
                    for (let i = 0; i < Math.min(options.minPoolSize, 10); i++) {
                        await mongoose.connection.db.admin().ping();
                    }
                    console.log('🔥 MongoDB connection pool warmed up');
                } catch (error) {
                    console.warn('Connection pool warm-up failed:', error.message);
                }
            };

            // Warm up connections after successful connection
            setTimeout(warmUpConnections, 1000);

            // Monitor connection pool more frequently
            setInterval(() => {
                try {
                    // Get pool information from mongoose connection
                    const topology = mongoose.connection.db?.topology || mongoose.connection.db?.serverConfig?.topology;
                    const poolSize = topology?.connections?.length || mongoose.connection.db?.serverConfig?.poolSize || options.maxPoolSize;
                    const activeConnections = topology?.connections?.filter(conn => conn && !conn.destroyed)?.length || 0;

                    connectionHealth.totalConnections = poolSize;
                    connectionHealth.activeConnections = activeConnections;

                    if (connectionHealth.consecutiveFailures > 3) {
                        console.warn('⚠️ High consecutive connection failures detected');
                    }

                    // Log connection pool status every 10 seconds for better monitoring
                    console.log(`🔗 MongoDB Pool: ${connectionHealth.activeConnections}/${connectionHealth.totalConnections} active, State: ${mongoose.connection.readyState}`);
                } catch (error) {
                    console.warn('Pool monitoring error:', error.message);
                    // Fallback to configured values
                    connectionHealth.totalConnections = options.maxPoolSize;
                    connectionHealth.activeConnections = 0;
                    console.log(`🔗 MongoDB Pool: ${connectionHealth.activeConnections}/${connectionHealth.totalConnections} active (fallback), State: ${mongoose.connection.readyState}`);
                }
            }, 10000); // Check every 10 seconds

        } catch (error) {
            connectionHealth.isHealthy = false;
            connectionHealth.consecutiveFailures++;
            connectionHealth.lastCheck = Date.now();

            if (retries < maxRetries) {
                retries++;
                const delay = Math.min(Math.pow(2, retries) * 1000, 30000); // Exponential backoff with max 30s
                console.error(`❌ MongoDB connection failed (attempt ${retries}/${maxRetries}). Retry in ${delay}ms`);
                console.error(`Error: ${error.message}`);
                setTimeout(connectWithRetry, delay);
            } else {
                console.error(`💀 MongoDB Connection Failed Permanently: ${error.message}`);
                console.error('Application will continue with degraded functionality');
                // Don't exit process - allow graceful degradation
                connectionHealth.isHealthy = false;
            }
        }
    };

    await connectWithRetry();
};

// Health check function for load balancer
export const checkMongoHealth = async () => {
    try {
        if (!connectionHealth.isHealthy) {
            return {
                status: 'unhealthy',
                message: 'MongoDB connection is not healthy',
                consecutiveFailures: connectionHealth.consecutiveFailures,
                lastCheck: new Date(connectionHealth.lastCheck).toISOString()
            };
        }

        // Perform a lightweight health check
        await mongoose.connection.db.admin().ping();
        return {
            status: 'healthy',
            connections: {
                total: connectionHealth.totalConnections,
                active: connectionHealth.activeConnections
            },
            lastCheck: new Date(connectionHealth.lastCheck).toISOString(),
            consecutiveFailures: connectionHealth.consecutiveFailures
        };
    } catch (error) {
        connectionHealth.isHealthy = false;
        connectionHealth.consecutiveFailures++;
        return {
            status: 'unhealthy',
            error: error.message,
            consecutiveFailures: connectionHealth.consecutiveFailures,
            lastCheck: new Date(connectionHealth.lastCheck).toISOString()
        };
    }
};

export default connectDB;
