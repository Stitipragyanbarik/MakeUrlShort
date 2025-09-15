import axios from 'axios'

// Create axios instance with base configuration
const apiClient = axios.create({
  baseURL: import.meta.env.REACT_APP_API_URL || 'https://makeurlshort.onrender.com/api',
  timeout: 10000, // 10 seconds timeout
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - runs before every request
apiClient.interceptors.request.use(
  (config) => {
    // You can add auth tokens here if needed
    // config.headers.Authorization = `Bearer ${token}`
    console.log(`Making ${config.method?.toUpperCase()} request to: ${config.url}`)
    return config
  },
  (error) => {
    console.error('Request error:', error)
    return Promise.reject(error)
  }
)

// Response interceptor - runs after every response
apiClient.interceptors.response.use(
  (response) => {
    // Log successful responses
    console.log(`✅ ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`)
    return response
  },
  (error) => {
    // Enhanced error handling
    console.error('❌ API Error:', error)

    if (error.response) {
      // Server responded with error status (4xx, 5xx)
      const { status, data } = error.response
      const url = error.config?.url || 'unknown'

      console.error(`❌ ${error.config?.method?.toUpperCase()} ${url} - ${status}`)

      switch (status) {
        case 400:
          error.message = data?.error || data?.message || 'Invalid request. Please check your input.'
          break
        case 401:
          error.message = 'Authentication required. Please log in.'
          break
        case 403:
          error.message = 'Access denied. You don\'t have permission for this action.'
          break
        case 404:
          error.message = 'Resource not found. The requested item may have been deleted.'
          break
        case 409:
          error.message = data?.error || 'Conflict. This resource already exists.'
          break
        case 422:
          error.message = data?.error || 'Validation failed. Please check your input.'
          break
        case 429:
          error.message = 'Too many requests. Please wait a moment and try again.'
          break
        case 500:
          error.message = 'Server error. Please try again later.'
          break
        case 502:
          error.message = 'Service temporarily unavailable. Please try again later.'
          break
        case 503:
          error.message = 'Service maintenance in progress. Please try again later.'
          break
        default:
          error.message = data?.error || data?.message || `Request failed with status ${status}`
      }

      // Add additional error context
      error.statusCode = status
      error.url = url

    } else if (error.request) {
      // Network error - no response received
      console.error('❌ Network Error:', error.request)

      if (error.code === 'ECONNABORTED') {
        error.message = 'Request timeout. Please check your connection and try again.'
      } else if (error.code === 'ERR_NETWORK') {
        error.message = 'Network error. Please check your internet connection.'
      } else {
        error.message = 'Unable to connect to server. Please check your connection.'
      }

    } else {
      // Request setup error
      console.error('❌ Request Setup Error:', error.message)
      error.message = error.message || 'An unexpected error occurred while setting up the request.'
    }

    return Promise.reject(error)
  }
)

export default apiClient
