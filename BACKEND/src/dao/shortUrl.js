import urlSchema from "../models/shorturlSchema.js";
import mongoose from "mongoose";

// Connection health check before operations
const checkConnectionHealth = () => {
    const state = mongoose.connection.readyState;
    if (state !== 1) { // 1 = connected
        throw new Error(`Database not connected. State: ${state}`);
    }
    return true;
};

export const saveShortUrl = async (shortUrl, longUrl, userId) => {
    try {
        // Check connection health before operation
        checkConnectionHealth();

        const newUrl = new urlSchema({
            full_url: longUrl,
            short_url: shortUrl,
            user: userId || undefined,
        });

        // Add timeout to prevent hanging - increased for better stability under load
        const savePromise = urlSchema.create(newUrl);
        const savedUrl = await Promise.race([
            savePromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Database save timeout')), 5000)
            )
        ]);

        return savedUrl;

    } catch (error) {
        console.error('Error in saveShortUrl:', error.message);

        if (error.code === 11000) {
            throw new Error('Short URL already exists');
        }

        if (error.message.includes('timeout')) {
            throw new Error('Database operation timeout - please try again');
        }

        if (error.message.includes('not connected')) {
            throw new Error('Database connection error - please try again');
        }

        throw new Error(`Database error: ${error.message}`);
    }
};

export const getShortUrl = async (shortUrl) => {
    try {
        // Check connection health before operation
        checkConnectionHealth();

        // Add timeout to prevent hanging
        const findPromise = urlSchema.findOneAndUpdate(
            { short_url: shortUrl },
            { $inc: { clicks: 1 } },
            { new: true } // Return updated document
        );

        const url = await Promise.race([
            findPromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Database query timeout')), 1500)
            )
        ]);

        return url;

    } catch (error) {
        console.error('Error in getShortUrl:', error.message);

        if (error.message.includes('timeout')) {
            throw new Error('Database operation timeout - please try again');
        }

        if (error.message.includes('not connected')) {
            throw new Error('Database connection error - please try again');
        }

        throw new Error(`Database error: ${error.message}`);
    }
};
