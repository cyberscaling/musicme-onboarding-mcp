/**
 * Always-mounted player host. Two playback backends:
 *   1. The hidden 1×1 WebView (streaming via the SDK) — default path.
 *   2. `<OfflineNativePlayer />` — used when the current track is in the
 *      offline catalog (downloaded via @demos/offline).
 *
 * The WebView itself lives off-screen (1×1px) so audio playback continues
 * regardless of navigation state. The visible mini-bar lives in this same
 * component but is conditionally rendered based on `track` + route segment
 * (hidden on the /player modal). This decoupling is what lets "swipe-down on
 * the player" dismiss the modal without tearing down the audio pipeline.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useSegments } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { OfflineModule, OfflineNativePlayer } from '@demos/offline'
import { Cover } from '@/components/Cover'
import { PLAYER_HTML } from '@/lib/playerHtml'
import { usePlayer, type PlayerEvent } from '@/lib/playerStore'

export function PersistentPlayer() {
  const player = usePlayer()
  const segments = useSegments()
  const webRef = useRef<WebView>(null)
  const readyRef = useRef(false)
  const pendingCmds = useRef<string[]>([])

  // Offline routing: when the current track is in the offline catalog, render
  // the native AVPlayer/ExoPlayer view instead of the WebView.
  const [offlineTrackId, setOfflineTrackId] = useState<string | null>(null)
  const offlineDurationRef = useRef(0)
  // Track which trackId the offline-resolution effect has finished checking.
  // Between a track change and that effect completing, the offline status is
  // unknown — we must not forward play/playlist commands to the WebView during
  // that window, otherwise an online stream is kicked off for a track that's
  // about to play offline.
  const offlineResolvedForRef = useRef<string | null>(null)
  const bufferedWebCmds = useRef<object[]>([])
  // Prop-driven control of the native offline player. requireNativeViewManager
  // doesn't dispatch AsyncFunction view methods through the ref, so we drive
  // play/pause/seek via props instead.
  const [offlinePlaying, setOfflinePlaying] = useState(true)
  const [offlineSeekToMs, setOfflineSeekToMs] = useState<number | null>(null)

  // Hide mini-bar when the /player modal is on top.
  const onPlayerScreen = segments.some((s) => s === 'player')
  const showMiniBar = !!player.track && !onPlayerScreen
  const first = (segments[0] ?? '') as string
  const tabBarVisible = first !== 'login' && first !== 'index' && first !== ''
  const insets = useSafeAreaInsets()
  // iOS bottom tab bar visual height ≈ 49 + safe-area inset (home indicator).
  const TAB_BAR_HEIGHT = 49 + insets.bottom

  const sendToWebView = useCallback((payload: object) => {
    const json = JSON.stringify(payload)
    if (readyRef.current && webRef.current) {
      webRef.current.postMessage(json)
    } else {
      pendingCmds.current.push(json)
    }
  }, [])

  // Resolve offline-routing when track changes.
  const currentTrackId = player.track
    ? `${player.track.cb}:${player.track.disc}:${player.track.track}`
    : null
  useEffect(() => {
    let cancelled = false
    if (!currentTrackId) {
      setOfflineTrackId(null)
      offlineDurationRef.current = 0
      offlineResolvedForRef.current = null
      bufferedWebCmds.current = []
      return
    }
    // Mark resolution pending for this trackId — drains in the .then below.
    offlineResolvedForRef.current = null
    void (async () => {
      try {
        const tracks = await OfflineModule.listTracks()
        if (cancelled) return
        const entry = tracks.find((t) => t.trackId === currentTrackId)
        if (entry) {
          offlineDurationRef.current = entry.meta.duration ?? 0
          // Reset transport state for the new offline track. autoPlay handles
          // the initial start; `playing` must be true so a subsequent pause→play
          // transition is detected by the native Prop observer.
          setOfflinePlaying(true)
          setOfflineSeekToMs(null)
          setOfflineTrackId(currentTrackId)
          // Track is offline — discard buffered WebView commands.
          bufferedWebCmds.current = []
        } else {
          offlineDurationRef.current = 0
          setOfflineTrackId(null)
          // Track is online — flush buffered commands to the WebView.
          const buf = bufferedWebCmds.current
          bufferedWebCmds.current = []
          for (const cmd of buf) sendToWebView(cmd)
        }
        offlineResolvedForRef.current = currentTrackId
      } catch {
        if (!cancelled) {
          offlineDurationRef.current = 0
          setOfflineTrackId(null)
          // Resolution failed — fall back to WebView (online) path.
          const buf = bufferedWebCmds.current
          bufferedWebCmds.current = []
          for (const cmd of buf) sendToWebView(cmd)
          offlineResolvedForRef.current = currentTrackId
        }
      }
    })()
    return () => { cancelled = true }
  }, [currentTrackId, sendToWebView])

  // Subscribe to commands from the store. Route to native player when offline,
  // otherwise to the WebView. For the offline backend we drive the native view
  // through declarative props (`playing`, `seekToMs`) because
  // requireNativeViewManager does not dispatch AsyncFunction view methods on
  // the JS ref — imperative ref calls silently no-op.
  useEffect(() => {
    return player.subscribeCommand((cmd) => {
      if (offlineTrackId) {
        if (cmd.type === 'play') setOfflinePlaying(true)
        else if (cmd.type === 'pause') setOfflinePlaying(false)
        else if (cmd.type === 'seek') setOfflineSeekToMs(cmd.t * 1000)
        return
      }
      // If the offline-resolution effect hasn't completed for the current
      // trackId yet, buffer the command instead of forwarding it to the
      // WebView. The effect flushes the buffer once status is known (or
      // discards it if the track is offline). This closes the race where a
      // synchronous dispatch from playSingle() reached the WebView before
      // hasTrack() resolved.
      if (currentTrackId && offlineResolvedForRef.current !== currentTrackId) {
        bufferedWebCmds.current.push(cmd)
        return
      }
      sendToWebView(cmd)
    })
  }, [player.subscribeCommand, sendToWebView, offlineTrackId, currentTrackId])

  // Reset `seekToMs` back to null after dispatching so the same target can be
  // re-applied later (Prop only fires on value change).
  useEffect(() => {
    if (offlineSeekToMs != null) {
      const id = setTimeout(() => setOfflineSeekToMs(null), 100)
      return () => clearTimeout(id)
    }
  }, [offlineSeekToMs])

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let event: PlayerEvent
      try {
        event = JSON.parse(e.nativeEvent.data) as PlayerEvent
      } catch {
        return
      }
      if (event.type === 'ready') {
        readyRef.current = true
        for (const q of pendingCmds.current) webRef.current?.postMessage(q)
        pendingCmds.current = []
        return
      }
      player.applyPlayerEvent(event)
    },
    [player.applyPlayerEvent],
  )

  const track = player.track

  return (
    <>
      {/* Hidden WebView — mounted while a track is active and not offline.
          1×1 + opacity:0 to keep it active without occupying layout.
          WKWebView keeps JS + audio running in this state. */}
      {track && !offlineTrackId ? (
        <View
          pointerEvents="none"
          style={styles.hiddenContainer}
          // keep mounted across screen changes
        >
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: PLAYER_HTML, baseUrl: 'https://localhost/' }}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            mixedContentMode="always"
            style={styles.hiddenWeb}
          />
        </View>
      ) : null}

      {/* Hidden OfflineNativePlayer — same 1×1 + opacity:0 trick. */}
      {track && offlineTrackId ? (
        <View pointerEvents="none" style={styles.hiddenContainer}>
          <OfflineNativePlayer
            trackId={offlineTrackId}
            autoPlay
            playing={offlinePlaying}
            seekToMs={offlineSeekToMs}
            style={styles.hiddenNative}
            onReady={() => {
              // Use the stored meta duration when available.
              const dur = offlineDurationRef.current
              player.applyPlayerEvent({ type: 'state', state: 'canplay' })
              if (dur > 0) {
                player.applyPlayerEvent({ type: 'time', current: 0, duration: dur })
              }
            }}
            onPlay={() => player.applyPlayerEvent({ type: 'playback', playing: true })}
            onPause={() => player.applyPlayerEvent({ type: 'playback', playing: false })}
            onTimeUpdate={(e) => {
              const positionMs = e.nativeEvent.position
              player.applyPlayerEvent({
                type: 'time',
                current: positionMs / 1000,
                duration: offlineDurationRef.current,
              })
            }}
            onEnded={() => player.applyPlayerEvent({ type: 'state', state: 'ended' })}
            onError={(e) => player.applyPlayerEvent({ type: 'error', message: e.nativeEvent.message })}
          />
        </View>
      ) : null}

      {showMiniBar && track ? (
        <MiniBar
          cb={track.cb}
          title={track.title ?? `${track.cb} · d${track.disc}t${track.track}`}
          artist={track.artist ?? null}
          playing={player.playing}
          progress={player.duration > 0 ? (player.currentTime / player.duration) * 100 : player.progress}
          onTap={() => router.push('/player')}
          onToggle={() => player.togglePlayback()}
          onPrev={() => player.prev()}
          onNext={() => player.next()}
          bottomOffset={tabBarVisible ? TAB_BAR_HEIGHT : 0}
          extraBottomPadding={tabBarVisible ? 0 : insets.bottom}
        />
      ) : null}
    </>
  )
}

function MiniBar(props: {
  cb: number
  title: string
  artist: string | null
  playing: boolean
  progress: number
  onTap: () => void
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
  bottomOffset: number
  extraBottomPadding: number
}) {
  return (
    <Pressable
      onPress={props.onTap}
      style={[styles.miniBar, { bottom: props.bottomOffset, paddingBottom: 8 + props.extraBottomPadding }]}
      accessibilityLabel="open player"
    >
      <View style={styles.miniProgressTrack}>
        <View style={[styles.miniProgressBar, { width: `${props.progress}%` }]} />
      </View>
      <View style={styles.miniInfoRow}>
        <Cover cb={props.cb} size={90} fallbackLabel={props.title} style={styles.miniCover} />
        <View style={styles.miniText}>
          <Text numberOfLines={1} style={styles.miniTitle}>{props.title}</Text>
          {props.artist ? (
            <Text numberOfLines={1} style={styles.miniArtist}>{props.artist}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation()
            router.push('/queue')
          }}
          style={styles.miniBtn}
          accessibilityLabel="open queue"
          hitSlop={6}
        >
          <Text style={styles.miniBtnIcon}>≡</Text>
        </Pressable>
      </View>
      <View style={styles.miniCtrlRow}>
        <Pressable
          onPress={(e) => { e.stopPropagation(); props.onPrev() }}
          style={styles.miniCtrlBtn}
          accessibilityLabel="prev"
          hitSlop={6}
        >
          <Text style={styles.miniCtrlIcon}>‹‹</Text>
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); props.onToggle() }}
          style={[styles.miniCtrlBtn, styles.miniCtrlPrimary]}
          accessibilityLabel={props.playing ? 'pause' : 'play'}
          hitSlop={6}
        >
          <Text style={[styles.miniCtrlIcon, styles.miniCtrlPrimaryIcon]}>{props.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); props.onNext() }}
          style={styles.miniCtrlBtn}
          accessibilityLabel="next"
          hitSlop={6}
        >
          <Text style={styles.miniCtrlIcon}>››</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hiddenContainer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  hiddenWeb: { width: 1, height: 1, backgroundColor: 'transparent' },
  hiddenNative: { width: 1, height: 1, backgroundColor: 'transparent' },
  miniBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#101010',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
  },
  miniProgressTrack: { height: 2, backgroundColor: '#222' },
  miniProgressBar: { height: 2, backgroundColor: '#4caf50' },
  miniInfoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, gap: 12 },
  miniCover: { width: 44, height: 44, borderRadius: 4 },
  miniText: { flex: 1 },
  miniArtist: { color: '#888', fontSize: 11, marginTop: 2 },
  miniCtrlRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingTop: 6 },
  miniCtrlBtn: { width: 44, height: 36, justifyContent: 'center', alignItems: 'center' },
  miniCtrlPrimary: { backgroundColor: '#eee', borderRadius: 18, minWidth: 56 },
  miniCtrlIcon: { color: '#eee', fontSize: 16 },
  miniCtrlPrimaryIcon: { color: '#000', fontSize: 18 },
  miniTitle: { color: '#eee', flex: 1, fontSize: 14, fontWeight: '500' },
  miniBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18 },
  miniBtnIcon: { color: '#eee', fontSize: 14 },
})
