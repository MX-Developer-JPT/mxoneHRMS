import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerServiceWorker } from '@/utils/pwa'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Register the service worker for PWA install + offline + push (production only)
if (import.meta.env.PROD) {
  window.addEventListener('load', () => { registerServiceWorker() })
}
