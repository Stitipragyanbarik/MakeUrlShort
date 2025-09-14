import { nanoid } from "nanoid";

export const generateNanoId=(length)=>{
    return nanoid(length);
}

export const validateCustomShortId = (shortId) => {
    // Check length (3-20 characters)
    if (shortId.length < 3 || shortId.length > 20) {
        return {
            valid: false,
            error: 'Custom short ID must be between 3 and 20 characters long'
        };
    }

    // Check for valid characters (alphanumeric, hyphens, underscores)
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(shortId)) {
        return {
            valid: false,
            error: 'Custom short ID can only contain letters, numbers, hyphens, and underscores'
        };
    }

    // Check for reserved words
    const reservedWords = ['api', 'health', 'metrics', 'admin', 'create', 'shorten'];
    if (reservedWords.includes(shortId.toLowerCase())) {
        return {
            valid: false,
            error: 'This custom short ID is reserved and cannot be used'
        };
    }

    return { valid: true };
};
