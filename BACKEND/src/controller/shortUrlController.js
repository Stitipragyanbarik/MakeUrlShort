import { getShortUrl } from "../dao/shortUrl.js";
import {  createShortUrlWithoutUser } from "../services/shorturlService.js";
import { urlCacheService } from "../services/cacheService.js";
import wrapAsync from "../utils/tryCatchWrapper.js";
import { validateCustomShortId } from "../utils/helper.js";

export const createShortUrl=wrapAsync(async (req,res)=>{
    const {url, customShortId}=req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // Validate custom short ID if provided
    if (customShortId) {
        const validation = validateCustomShortId(customShortId);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
    }

    // Create short URL (service already has proper timeout + retries)
    const shortUrl = await createShortUrlWithoutUser(url, customShortId);

    const BASE_URL =  process.env.APP_URL?.endsWith('/') 
                 ? process.env.APP_URL 
                 : process.env.APP_URL + '/';
    const fullShortUrl = `${BASE_URL}${shortUrl}`;

    // Cache asynchronously (fire and forget)
    const urlData = { full_url: url, short_url: shortUrl, clicks: 0 };
    urlCacheService.cacheNewUrl(shortUrl, urlData).catch(err =>
        console.error('Cache operation failed:', err)
    );

    res.json({
        shortUrl: fullShortUrl,
        originalUrl: url,
        custom: !!customShortId
    });

})

export const redirectFromShortUrl= wrapAsync(async(req,res)=>{

    const {id}=req.params;

    // Use cached service for faster lookups
    const url = await urlCacheService.getShortUrl(id);

    if (!url) {
        return res.status(404).json({ error: "Short URL not found" });
    }

    res.redirect(url.full_url);

})