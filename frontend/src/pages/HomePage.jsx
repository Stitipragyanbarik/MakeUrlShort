import React from 'react'
import Header from '../components/Header'
import UrlShortener from '../components/UrlShortener'

function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-5">
      <div className="bg-white rounded-3xl p-10 shadow-2xl w-full max-w-2xl text-center">
        <Header />
        <UrlShortener />
      </div>
    </div>
  )
}

export default HomePage