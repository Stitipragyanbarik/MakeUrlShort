import { useState } from 'react'
import UrlForm from './UrlForm'
import ResultSection from './ResultSection'
import { createShortUrl, isValidUrl, handleApiError } from '../api/ShortUrlapi'

function UrlShortener() {
  const [url, setUrl] = useState('')
  const [shortUrl, setShortUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!url) {
      setError('Please enter a URL')
      return
    }

    // URL validation using API utility
    if (!isValidUrl(url)) {
      setError('Please enter a valid URL')
      return
    }

    setLoading(true)
    setError('')

    try {
      const data = await createShortUrl(url)
      setShortUrl(data.shortUrl)
    } catch (err) {
      setError(handleApiError(err))
      console.error('Error:', err)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shortUrl)
    setCopied(true)
    // Reset the copied state after 2 seconds
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  const resetForm = () => {
    setUrl('')
    setShortUrl('')
    setError('')
    setCopied(false)
  }

  return (
    <div>
      <UrlForm 
        url={url}
        setUrl={setUrl}
        loading={loading}
        error={error}
        onSubmit={handleSubmit}
      />
      
      {shortUrl && (
        <ResultSection
          shortUrl={shortUrl}
          onCopy={copyToClipboard}
          onReset={resetForm}
          copied={copied}
        />
      )}
    </div>
  )
}

export default UrlShortener
