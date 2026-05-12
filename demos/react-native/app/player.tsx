/**
 * Full-screen player view. Renders timeline + logs + metrics. The WebView that
 * actually decrypts and plays audio lives in <PersistentPlayer /> at the root
 * layout — this screen is purely UI consuming the shared store, so swipe-down
 * dismissing the modal does NOT tear down playback.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { DownloadButton } from '@/components/DownloadButton'
import { usePlayer } from '@/lib/playerStore'

function pad(n: number, w = 2): string {
  return n.toString().padStart(w, '0')
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.000'
  const ms = Math.floor((seconds % 1) * 1000)
  const total = Math.floor(seconds)
  const s = total % 60
  const m = Math.floor(total / 60)
  return `${m}:${pad(s)}.${pad(ms, 3)}`
}

function formatLogTs(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export default function PlayerScreen() {
  const p = usePlayer()
  const track = p.track

  if (!track) {
    // Reaching the modal without an active track is a UX error — bounce back.
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>no active track</Text>
        <Pressable onPress={() => router.back()} style={styles.linkBtn}>
          <Text style={styles.linkBtnText}>back</Text>
        </Pressable>
      </View>
    )
  }

  const playToCanplay = p.startedAt && p.canplayAt ? p.canplayAt - p.startedAt : null

  return (
    <View style={styles.root}>
    <TopNav title="Player" back />
    <ScrollView
      contentContainerStyle={styles.rootContent}
      showsVerticalScrollIndicator
    >

      <View style={styles.titleRow}>
        <View style={styles.titleCol}>
          <Text style={styles.title} numberOfLines={2}>
            {track.title ?? `cb ${track.cb} · d${track.disc} · t${track.track}`}
          </Text>
          <Text style={styles.muted}>
            cb={track.cb} · disc={track.disc} · track={track.track}
          </Text>
        </View>
        <DownloadButton
          trackId={`${track.cb}:${track.disc}:${track.track}`}
          metaJson={JSON.stringify({
            ...(track.title ? { title: track.title } : {}),
            ...(track.artist ? { artist: track.artist } : {}),
            duration: p.duration,
          })}
        />
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(p.currentTime)}</Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressBar,
              { width: `${p.duration > 0 ? (p.currentTime / p.duration) * 100 : 0}%` },
            ]}
          />
        </View>
        <Text style={styles.timeText}>{formatTime(p.duration)}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.ctrlBtn} onPress={() => p.prev()} accessibilityLabel="prev track">
          <Text style={styles.ctrlIcon}>‹‹</Text>
        </Pressable>
        <Pressable style={styles.ctrlBtn} onPress={() => p.seek(Math.max(0, p.currentTime - 10))} accessibilityLabel="-10s">
          <Text style={styles.ctrlIcon}>−10s</Text>
        </Pressable>
        <Pressable style={[styles.ctrlBtn, styles.ctrlPrimary]} onPress={() => p.togglePlayback()}>
          <Text style={[styles.ctrlIcon, styles.ctrlPrimaryIcon]}>{p.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable style={styles.ctrlBtn} onPress={() => p.seek(p.currentTime + 10)} accessibilityLabel="+10s">
          <Text style={styles.ctrlIcon}>+10s</Text>
        </Pressable>
        <Pressable style={styles.ctrlBtn} onPress={() => p.next()} accessibilityLabel="next track">
          <Text style={styles.ctrlIcon}>››</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <Stat label="phase" value={p.phase} />
        <Stat label="stream" value={`${p.progress.toFixed(0)}%`} />
        <Stat label="play→canplay" value={playToCanplay !== null ? `${playToCanplay}ms` : '—'} />
      </View>

      {p.metrics ? (
        <View style={styles.metricsBox}>
          <Text style={styles.metricsTitle}>
            phases (ms) · mode={p.metrics.mode} · {p.metrics.file_size_bytes} bytes
          </Text>
          {(
            [
              'get_token',
              'init_session',
              'fetch_key',
              'mse_setup',
              'first_chunk_fetch',
              'first_decrypt',
              'mp4box_ready',
              'first_append_to_canplay',
              'total',
            ] as const
          ).map((k) => (
            <View key={k} style={styles.metricsRow}>
              <Text style={styles.metricsKey}>{k}</Text>
              <Text style={styles.metricsValue}>{p.metrics ? p.metrics.phases_ms[k].toFixed(1) : '—'}</Text>
            </View>
          ))}
          <Text style={[styles.metricsTitle, { marginTop: 8 }]}>server total (ms)</Text>
          <View style={styles.metricsRow}>
            <Text style={styles.metricsKey}>init_session</Text>
            <Text style={styles.metricsValue}>{p.metrics.server_ms.init_session.toFixed(1)}</Text>
          </View>
          <View style={styles.metricsRow}>
            <Text style={styles.metricsKey}>fetch_key</Text>
            <Text style={styles.metricsValue}>{p.metrics.server_ms.fetch_key.toFixed(1)}</Text>
          </View>
        </View>
      ) : null}

      {p.serverTimings.length > 0 ? (
        <View style={styles.metricsBox}>
          {p.serverTimings.map((t) => {
            const entries = Object.entries(t.phases).filter(([k]) => k !== 'app')
            const total = t.phases.total ?? t.phases.app ?? 0
            const descEntries = Object.entries(t.desc ?? {})
            return (
              <View key={t.endpoint} style={{ marginBottom: 6 }}>
                <Text style={styles.metricsTitle}>
                  server[{t.endpoint}] phases (ms) · total={total.toFixed(1)}
                </Text>
                {entries
                  .filter(([k]) => k !== 'total')
                  .map(([k, v]) => (
                    <View key={k} style={styles.metricsRow}>
                      <Text style={styles.metricsKey}>{k}</Text>
                      <Text style={styles.metricsValue}>{v.toFixed(1)}</Text>
                    </View>
                  ))}
                {descEntries.map(([k, v]) => (
                  <View key={`desc-${k}`} style={styles.metricsRow}>
                    <Text style={styles.metricsKey}>{k}</Text>
                    <Text style={styles.metricsValue}>{v}</Text>
                  </View>
                ))}
              </View>
            )
          })}
        </View>
      ) : null}

      <Text style={styles.label}>console</Text>
      <View style={styles.console}>
        {p.logs.map((l) => (
          <Text
            key={l.id}
            style={[styles.logLine, l.level === 'err' && styles.logErr, l.level === 'ok' && styles.logOk]}
          >
            {formatLogTs(l.ts)} · {l.message}
          </Text>
        ))}
      </View>
    </ScrollView>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  rootContent: { padding: 16, paddingBottom: 220 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginVertical: 8 },
  title: { color: '#eee', fontSize: 18, fontWeight: '600', marginTop: 4 },
  muted: { color: '#777', fontSize: 11, fontFamily: 'Menlo', marginTop: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleCol: { flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 8 },
  timeText: { color: '#bbb', fontFamily: 'Menlo', fontSize: 11, width: 78 },
  progressTrack: { flex: 1, height: 4, backgroundColor: '#222', borderRadius: 2 },
  progressBar: { height: 4, backgroundColor: '#4caf50', borderRadius: 2 },
  controls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: 16, paddingHorizontal: 8 },
  ctrlBtn: { paddingVertical: 10, paddingHorizontal: 8, borderRadius: 6, minWidth: 44, alignItems: 'center' },
  ctrlPrimary: { backgroundColor: '#eee', minWidth: 56 },
  ctrlIcon: { color: '#eee', fontFamily: 'Menlo', fontSize: 16 },
  ctrlPrimaryIcon: { color: '#000', fontSize: 18 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  statBox: { flex: 1, backgroundColor: '#0a0a0a', borderRadius: 6, padding: 10 },
  statLabel: { color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { color: '#eee', fontFamily: 'Menlo', fontSize: 13, marginTop: 4 },
  metricsBox: { marginTop: 16, backgroundColor: '#0a0a0a', borderRadius: 6, padding: 10 },
  metricsTitle: { color: '#bbb', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  metricsKey: { color: '#888', fontFamily: 'Menlo', fontSize: 11 },
  metricsValue: { color: '#eee', fontFamily: 'Menlo', fontSize: 11 },
  label: { color: '#aaa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 4 },
  console: { backgroundColor: '#0a0a0a', borderRadius: 4, padding: 8 },
  logLine: { color: '#888', fontFamily: 'Menlo', fontSize: 11, marginBottom: 2 },
  logOk: { color: '#7fc97f' },
  logErr: { color: '#ff6666' },
  linkBtn: { marginTop: 12, padding: 8 },
  linkBtnText: { color: '#888', textDecorationLine: 'underline' },
})
