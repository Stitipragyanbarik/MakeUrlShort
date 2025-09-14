function UrlForm({ url, setUrl, loading, error, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="mb-8">
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter your long URL here..."
          className="flex-1 px-5 py-4 border-2 border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-gray-50 disabled:cursor-not-allowed min-w-64"
          disabled={loading}
        />
        <button
          type="submit"
          className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white border-none rounded-xl text-base font-semibold cursor-pointer transition-all duration-300 hover:transform hover:-translate-y-1 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none whitespace-nowrap"
          disabled={loading || !url}
        >
          {loading ? 'Shortening...' : 'Shorten URL'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 px-5 py-3 rounded-lg border border-red-200 text-sm">
          {error}
        </div>
      )}
    </form>
  )
}

export default UrlForm