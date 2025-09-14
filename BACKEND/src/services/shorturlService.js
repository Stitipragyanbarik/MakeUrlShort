import { generateNanoId } from "../utils/helper.js";
import { saveShortUrl } from "../dao/shortUrl.js";
import { cacheService } from "../config/redis.config.js";

// Persist mapping if possible; if DB/Redis slow, still return short code and attempt background persistence
export const createShortUrlWithoutUser = async (url, customShortId) => {
  // If custom short ID provided, use it directly
  if (customShortId) {
    try {
      const savePromise = saveShortUrl(customShortId, url);
      await Promise.race([
        savePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Save quick-timeout")), 2500))
      ]);
      return customShortId;
    } catch (error) {
      if (error.message === "Short URL already exists") {
        throw new Error("Custom short URL already exists - please choose a different one");
      }
      throw error;
    }
  }

  // Fast path: attempt a quick DB save; if slow, degrade immediately and persist in background
  const maxCollisions = 5; // Increased from 2 to handle higher load
  for (let attempt = 0; attempt <= maxCollisions; attempt++) {
    const shortUrl = generateNanoId(8); // Increased from 7 to 8 characters (64x less collisions)
    if (!shortUrl) throw new Error("Short URL not generated");

    try {
      const savePromise = saveShortUrl(shortUrl, url);
      await Promise.race([
        savePromise,
        // Timeout tuned for 150 req/sec stability
        new Promise((_, reject) => setTimeout(() => reject(new Error("Save quick-timeout")), 2500))
      ]);
      // Saved fast – return immediately
      return shortUrl;
    } catch (error) {
      console.error(`❌ Error saving short URL ${shortUrl} on attempt ${attempt + 1}: ${error.message}`);
      // Retry on collision with exponential backoff
      if (error.message === "Short URL already exists" && attempt < maxCollisions) {
        // Add small delay to reduce collision likelihood
        const delay = Math.pow(2, attempt) * 10;
        console.log(`🔄 Collision detected for ${shortUrl}, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Graceful degrade: cache mapping and schedule background persistence; return immediately
      try {
        const cacheKey = `url:${shortUrl}`;
        const urlData = { full_url: url, short_url: shortUrl, clicks: 0 };
        await cacheService.set(cacheKey, urlData, 600); // 10 minutes
        console.log(`⚠️ Database timeout - cached URL ${shortUrl} for background persistence`);
      } catch (cacheError) {
        console.error('Cache error during graceful degradation:', cacheError.message);
      }

      // Schedule background persistence with exponential backoff
      setTimeout(async () => {
        let retryCount = 0;
        const maxRetries = 3;

        const retrySave = async () => {
          try {
            await saveShortUrl(shortUrl, url);
            console.log(`✅ Background persistence successful for ${shortUrl}`);
          } catch (saveError) {
            retryCount++;
            if (retryCount < maxRetries && !saveError.message.includes('already exists')) {
              const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
              console.log(`⏳ Background persistence retry ${retryCount}/${maxRetries} for ${shortUrl} in ${delay}ms`);
              setTimeout(retrySave, delay);
            } else {
              console.error(`❌ Background persistence failed for ${shortUrl} after ${maxRetries} retries:`, saveError.message);
            }
          }
        };

        retrySave();
      }, 100); // Small delay to return response immediately

      return shortUrl;
    }
  }

  throw new Error("Failed to generate unique short URL after maximum attempts");
};

export const createShortUrlWithUser = async (url, userId) => {
  const shortUrl = generateNanoId(8); // Updated to match the length increase
  if (!shortUrl) throw new Error("Short URL not generated");

  try {
    const savePromise = saveShortUrl(shortUrl, url, userId);
    await Promise.race([
      savePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Save timeout")), 3000))
    ]);
    return shortUrl;
  } catch (error) {
    if (error.message === "Short URL already exists") {
      throw new Error("Short URL already exists - please try again");
    }

    // Same graceful degradation for user-bound creation
    try {
      const cacheKey = `url:${shortUrl}`;
      const urlData = { full_url: url, short_url: shortUrl, clicks: 0, user: userId };
      await cacheService.set(cacheKey, urlData, 1800);
    } catch (_) {}

    setTimeout(async () => {
      try {
        await saveShortUrl(shortUrl, url, userId);
      } catch (_) {}
    }, 0);

    return shortUrl;
  }
};
