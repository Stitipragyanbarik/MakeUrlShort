import apiClient from './axiosConfig'

// API endpoints
const ENDPOINTS = {
  CREATE_SHORT_URL: '/create'
}

/**
 * Create a shortened URL
 * @param {string} url - The long URL to shorten
 * @returns {Promise<Object>} Response containing shortUrl and originalUrl
 */
export const createShortUrl = async (url) => {
  try {
    const response = await apiClient.post(ENDPOINTS.CREATE_SHORT_URL, { url })
    return response.data
  } catch (error) {
    console.error('Error creating short URL:', error)
    throw error
  }
}

/**
 * Validate if a string is a valid URL
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid URL, false otherwise
 */
export const isValidUrl = (url) => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * API error handler utility
 * @param {Error} error - The error to handle
 * @returns {string} User-friendly error message
 */
export const handleApiError = (error) => {
  // Axios interceptors already handle most error formatting
  return error.message || 'An unexpected error occurred. Please try again.'
}