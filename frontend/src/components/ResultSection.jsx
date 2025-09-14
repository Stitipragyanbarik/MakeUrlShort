function ResultSection({ shortUrl, onCopy, onReset, copied }) {
  return (
    <div className="bg-gray-50 p-8 rounded-2xl mt-5">
      <h3 className="text-gray-800 mb-5 text-xl font-semibold">Your shortened URL:</h3>
      <div className="flex gap-3 mb-5 flex-wrap">
        <input
          type="text"
          value={shortUrl}
          readOnly
          className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg text-base bg-white min-w-52"
        />
        <button
          onClick={onCopy}
          className={`px-5 py-3 border-none rounded-lg text-sm cursor-pointer transition-all duration-300 hover:transform hover:-translate-y-0.5 whitespace-nowrap ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
        >
          {copied ? '✓ Copied!' : '📋 Copy'}
        </button>
      </div>
      <button
        onClick={onReset}
        className="px-6 py-3 bg-transparent text-blue-500 border-2 border-blue-500 rounded-lg text-sm cursor-pointer transition-all duration-300 hover:bg-blue-500 hover:text-white"
      >
        Shorten Another URL
      </button>
    </div>
  )
}

export default ResultSection
