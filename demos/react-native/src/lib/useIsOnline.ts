// demos/react-native/src/lib/useIsOnline.ts
import { useEffect, useState } from 'react'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'

/**
 * Reactive connectivity. true when the device has both an active interface
 * AND the OS reports internet-reachable (NetInfo's `isInternetReachable` is
 * tri-state: true | false | null; we treat null as "still optimistic" =
 * online to avoid showing the offline banner during the very first second
 * after app launch).
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    function apply(s: NetInfoState) {
      const reachable = s.isInternetReachable
      setOnline(!!s.isConnected && reachable !== false)
    }
    void NetInfo.fetch().then(apply)
    const unsub = NetInfo.addEventListener(apply)
    return () => unsub()
  }, [])
  return online
}
