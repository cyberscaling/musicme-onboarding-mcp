/**
 * Always-mounted player host. All playback (streaming + offline) goes through
 * a single hidden 1×1 <NativePlayer />. The view stays mounted across
 * navigation so audio continues uninterrupted.
 */
import { useEffect, useRef } from 'react'
import { StyleSheet, Text, View, Pressable, Platform } from 'react-native'
import { router, useSegments } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NativePlayer, OfflineModule, Player } from '@demos/offline'
import { Cover } from '@/components/Cover'
import { usePlayer } from '@/lib/playerStore'
import { coverUrl as buildCoverUrl } from '@/lib/covers'

export function PersistentPlayer() {
  const player = usePlayer()

  const prefetchedFor = useRef<string | null>(null)
  const PREFETCH_LEAD_S = 5

  const track = player.track

  useEffect(() => { prefetchedFor.current = null }, [track?.cb, track?.disc, track?.track])

  const onTimeUpdate = (e: { nativeEvent: { position: number; duration: number } }) => {
    const positionS = e.nativeEvent.position / 1000
    const durationS = e.nativeEvent.duration / 1000
    player.applyPlayerEvent({ type: 'time', current: positionS, duration: durationS })
    if (durationS > 0 && positionS >= durationS - PREFETCH_LEAD_S) {
      const np = player.nowPlaying
      const idx = player.currentIndex
      if (idx >= 0 && idx + 1 < np.length) {
        const next = np[idx + 1]!
        const id = `${next.ref.cb}:${next.ref.disc}:${next.ref.track}`
        if (prefetchedFor.current !== id) {
          prefetchedFor.current = id
          void Player.prefetch(next.ref)
        }
      }
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const m = OfflineModule as unknown as {
      addListener?: (name: string, cb: () => void) => { remove: () => void }
    }
    const subN = m.addListener?.('player:remote:next', () => player.next())
    const subP = m.addListener?.('player:remote:prev', () => player.prev())
    return () => { subN?.remove?.(); subP?.remove?.() }
  }, [player])

  const segments = useSegments()
  const insets = useSafeAreaInsets()
  const onPlayerScreen = segments.some((s) => s === 'player')
  const first = (segments[0] ?? '') as string
  const tabBarVisible = first !== 'login' && first !== 'index' && first !== ''
  const TAB_BAR_HEIGHT = 49 + insets.bottom

  const showMiniBar = !!track && !onPlayerScreen

  return (
    <>
      {track ? (
        <View pointerEvents="none" style={styles.hidden}>
          <NativePlayer
            trackRef={{ cb: track.cb, disc: track.disc, track: track.track }}
            title={track.title}
            artist={track.artist}
            coverUrl={buildCoverUrl(track.cb, 295)}
            autoPlay
            playing={player.playing}
            seekToMs={player.seekToMs}
            style={styles.hiddenView}
            onReady={(e) => {
              const durMs = e.nativeEvent.duration
              player.applyPlayerEvent({ type: 'state', state: 'canplay' })
              if (durMs > 0) {
                player.applyPlayerEvent({ type: 'time', current: 0, duration: durMs / 1000 })
              }
            }}
            onPlay={() => player.applyPlayerEvent({ type: 'playback', playing: true })}
            onPause={() => player.applyPlayerEvent({ type: 'playback', playing: false })}
            onTimeUpdate={onTimeUpdate}
            onEnded={() => player.applyPlayerEvent({ type: 'state', state: 'ended' })}
            onError={(e) => player.applyPlayerEvent({ type: 'error', message: e.nativeEvent.message })}
            onStalled={() => player.applyPlayerEvent({ type: 'log', level: 'err', message: 'stalled' })}
            onSessionRotated={() => player.applyPlayerEvent({ type: 'log', level: 'info', message: 'session_rotated' })}
            onMetrics={(e) => player.applyPlayerEvent({ type: 'metrics', report: e.nativeEvent })}
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
  cb: number; title: string; artist: string | null; playing: boolean
  progress: number; onTap: () => void; onToggle: () => void
  onPrev: () => void; onNext: () => void
  bottomOffset: number; extraBottomPadding: number
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
        <Pressable onPress={(e) => { e.stopPropagation(); router.push('/queue') }}
          style={styles.miniBtn} accessibilityLabel="open queue" hitSlop={6}>
          <Text style={styles.miniBtnIcon}>≡</Text>
        </Pressable>
      </View>
      <View style={styles.miniCtrlRow}>
        <Pressable onPress={(e) => { e.stopPropagation(); props.onPrev() }} style={styles.miniCtrlBtn} accessibilityLabel="prev" hitSlop={6}>
          <Text style={styles.miniCtrlIcon}>‹‹</Text>
        </Pressable>
        <Pressable onPress={(e) => { e.stopPropagation(); props.onToggle() }} style={[styles.miniCtrlBtn, styles.miniCtrlPrimary]} accessibilityLabel={props.playing ? 'pause' : 'play'} hitSlop={6}>
          <Text style={[styles.miniCtrlIcon, styles.miniCtrlPrimaryIcon]}>{props.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable onPress={(e) => { e.stopPropagation(); props.onNext() }} style={styles.miniCtrlBtn} accessibilityLabel="next" hitSlop={6}>
          <Text style={styles.miniCtrlIcon}>››</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  hiddenView: { width: 1, height: 1, backgroundColor: 'transparent' },
  miniBar: { position: 'absolute', left: 0, right: 0, backgroundColor: '#101010', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2a2a2a' },
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
