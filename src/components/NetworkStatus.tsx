import { useEffect, useState } from 'react'
import { copyId } from '../copy/id'

export function NetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [showRestored, setShowRestored] = useState(false)

  useEffect(() => {
    function handleOnline() {
      setOnline(true)
      setShowRestored(true)
      window.setTimeout(() => setShowRestored(false), 5000)
    }
    function handleOffline() {
      setOnline(false)
      setShowRestored(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online && !showRestored) return null
  return (
    <p className={`network-notice${online ? ' network-notice-restored' : ''}`} role="status" aria-live="polite">
      {online ? copyId.network.online : copyId.network.offline}
    </p>
  )
}
