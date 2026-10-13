import { useEffect, useState } from 'react'
import { readDatabaseUnavailable, readNavigatorOnLine, readOnlineStatus, subscribeOnlineStatus } from '@/lib/networkConnectivity'

export function useOnlineStatus() {
  const readStatus = () => ({
    isOnline: readOnlineStatus(),
    isDatabaseOffline: readNavigatorOnLine() && readDatabaseUnavailable(),
  })
  const [status, setStatus] = useState(readStatus)

  useEffect(() => subscribeOnlineStatus(() => setStatus(readStatus())), [])

  return { ...status, isOffline: !status.isOnline }
}
