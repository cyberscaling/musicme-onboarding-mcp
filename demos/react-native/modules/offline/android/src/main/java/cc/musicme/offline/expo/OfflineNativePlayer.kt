package cc.musicme.offline.expo

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player as MediaPlayer
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import cc.musicme.offline.TrackRef
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@OptIn(UnstableApi::class)
class NativePlayer(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

    val onReady by EventDispatcher()
    val onError by EventDispatcher()
    val onPlay by EventDispatcher()
    val onPause by EventDispatcher()
    val onTimeUpdate by EventDispatcher()
    val onEnded by EventDispatcher()
    val onStalled by EventDispatcher()
    val onSessionRotated by EventDispatcher()
    val onMetrics by EventDispatcher()

    var autoPlay: Boolean = false
    var trackTitle: String? = null
    var trackArtist: String? = null
    var trackCoverUrl: String? = null

    private var loadStartedAt: Long = 0L
    private var canplayAt: Long = 0L
    private var bufferUnderruns: Int = 0
    private var lastEmittedFor: String? = null
    private var currentSource: cc.musicme.offline.ByteSource? = null
    private var currentRefStr: String? = null
    private var player: ExoPlayer? = null
    private val session = MediaSessionController(context)
    private val focus = AudioFocusController(context)
    private val main = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (p.isPlaying) {
                onTimeUpdate(mapOf(
                    "position" to p.currentPosition.toDouble(),
                    "duration" to p.duration.toDouble()
                ))
            }
            main.postDelayed(this, 500L)
        }
    }

    fun load(cb: Long, disc: Int, track: Int) {
        val svc = OfflineSingleton.service ?: run {
            onError(mapOf("message" to "player_not_configured"))
            return
        }
        val workerUrl = PlayerConfig.workerUrl
        val tokenProvider = PlayerConfig.tokenProvider
        if (workerUrl == null || tokenProvider == null) {
            onError(mapOf("message" to "player_not_configured")); return
        }
        if (currentRefStr != null) emitMetrics("aborted")
        currentRefStr = "$cb:$disc:$track"
        loadStartedAt = System.currentTimeMillis()
        canplayAt = 0L
        bufferUnderruns = 0
        lastEmittedFor = null
        player?.release()

        val trackId = "$cb:$disc:$track"
        val sourceProvider = {
            val cached = PrefetchCache.take(trackId)
            val s = cached ?: kotlinx.coroutines.runBlocking {
                svc.openSource(TrackRef(cb, disc, track), workerUrl, tokenProvider)
            }
            currentSource = s
            s
        }
        PrefetchCache.clear(except = trackId)
        val factory = SasPlayerDataSource.Factory(sourceProvider)
        val msFactory = DefaultMediaSourceFactory(context).setDataSourceFactory(factory)

        val exo = ExoPlayer.Builder(context)
            .setMediaSourceFactory(msFactory)
            .build()
        val uri = android.net.Uri.parse("${SasPlayerDataSource.SCHEME}://$cb:$disc:$track/audio.m4a")
        exo.setMediaItem(MediaItem.fromUri(uri))
        exo.addListener(object : MediaPlayer.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    MediaPlayer.STATE_READY -> {
                        if (canplayAt == 0L) canplayAt = System.currentTimeMillis()
                        onReady(mapOf("duration" to exo.duration.toDouble()))
                    }
                    MediaPlayer.STATE_ENDED -> {
                        emitMetrics("canplay")
                        onEnded(emptyMap())
                    }
                    MediaPlayer.STATE_BUFFERING -> {
                        bufferUnderruns++
                        onStalled(emptyMap())
                    }
                    else -> {}
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) onPlay(emptyMap()) else onPause(emptyMap())
            }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                emitMetrics("error")
                onError(mapOf("message" to (error.message ?: "unknown")))
            }
        })
        exo.prepare()
        if (autoPlay) exo.play()
        player = exo
        session.activate(
            title = trackTitle ?: "$cb/$disc/$track",
            artist = trackArtist,
            coverUrl = trackCoverUrl,
            onPlay = { setPlaying(true) },
            onPause = { setPlaying(false) },
            onNext = { RemoteEvents.onNext?.invoke() },
            onPrev = { RemoteEvents.onPrev?.invoke() },
            onSeek = { ms -> seek(ms.toDouble()) },
        )
        focus.request(
            onLoss = { setPlaying(false) },
            onDuck = {},
            onRegain = { setPlaying(true) },
        )
        main.removeCallbacks(tick); main.postDelayed(tick, 500L)
    }

    fun setPlaying(playing: Boolean) {
        val p = player ?: return
        if (playing) p.play() else p.pause()
        session.setPlaybackState(playing, p.currentPosition)
    }
    fun seek(positionMs: Double) { player?.seekTo(positionMs.toLong()) }

    override fun onDetachedFromWindow() {
        main.removeCallbacks(tick)
        if (currentRefStr != null && lastEmittedFor != currentRefStr) emitMetrics("aborted")
        player?.release(); player = null
        focus.abandon()
        session.release()
        super.onDetachedFromWindow()
    }

    private fun emitMetrics(outcome: String) {
        val ref = currentRefStr ?: return
        if (lastEmittedFor == ref) return
        lastEmittedFor = ref

        val firstCanplayMs: Double? = if (loadStartedAt != 0L && canplayAt != 0L)
            (canplayAt - loadStartedAt).toDouble() else null
        val totalPlayMs: Double? = if (loadStartedAt != 0L)
            (System.currentTimeMillis() - loadStartedAt).toDouble() else null

        val src = currentSource as? cc.musicme.offline.StreamSource
        val m = src?.metrics()
        onMetrics(mapOf(
            "v" to 1,
            "trackRef" to ref,
            "outcome" to outcome,
            "bootstrapMs" to (m?.bootstrapMs as Any?),
            "firstKeyMs" to 0,
            "firstRangeMs" to (m?.firstRangeMs as Any?),
            "firstCanplayMs" to (firstCanplayMs as Any?),
            "totalPlayMs" to (totalPlayMs as Any?),
            "bufferUnderruns" to bufferUnderruns,
            "sessionRotations" to (m?.sessionRotations ?: 0),
            "fileSizeBytes" to (m?.fileSizeBytes as Any?),
        ))
    }
}

object PlayerConfig {
    @Volatile var workerUrl: String? = null
    @Volatile var tokenProvider: (suspend () -> String)? = null
    @Volatile var currentToken: String? = null
}

object RemoteEvents {
    @Volatile var onNext: (() -> Unit)? = null
    @Volatile var onPrev: (() -> Unit)? = null
}
