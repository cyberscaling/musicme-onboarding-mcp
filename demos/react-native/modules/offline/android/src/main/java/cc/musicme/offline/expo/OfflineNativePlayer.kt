package cc.musicme.offline.expo

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@OptIn(UnstableApi::class)
class OfflineNativePlayer(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

    val onReady by EventDispatcher()
    val onError by EventDispatcher()
    val onPlay by EventDispatcher()
    val onPause by EventDispatcher()
    val onTimeUpdate by EventDispatcher()
    val onEnded by EventDispatcher()

    var autoPlay: Boolean = false

    private var player: ExoPlayer? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val timeRunnable = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (p.isPlaying) {
                onTimeUpdate(mapOf("position" to p.currentPosition.toDouble()))
            }
            mainHandler.postDelayed(this, 500L)
        }
    }

    fun load(trackId: String) {
        val svc = OfflineSingleton.service ?: run {
            onError(mapOf("message" to "offline service not ready"))
            return
        }
        player?.release()

        val factory = OfflineAssetDataSource.Factory(svc) {
            DeviceIdProvider.current(context)
        }
        val mediaSourceFactory = DefaultMediaSourceFactory(context).setDataSourceFactory(factory)

        val exo = ExoPlayer.Builder(context)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()

        val encoded = android.net.Uri.encode(trackId)
        val uri = android.net.Uri.parse("${OfflineAssetDataSource.SCHEME}://$encoded/audio.m4a")
        exo.setMediaItem(MediaItem.fromUri(uri))

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_READY -> onReady(emptyMap())
                    Player.STATE_ENDED -> onEnded(emptyMap())
                    else -> {}
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) onPlay(emptyMap()) else onPause(emptyMap())
            }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                onError(mapOf("message" to (error.message ?: "unknown")))
            }
        })

        exo.prepare()
        if (autoPlay) exo.play()
        player = exo

        mainHandler.removeCallbacks(timeRunnable)
        mainHandler.postDelayed(timeRunnable, 500L)
    }

    fun setPlaying(playing: Boolean) {
        val p = player ?: return
        if (playing) p.play() else p.pause()
        // onPlay / onPause emitted by Player.Listener.onIsPlayingChanged.
    }

    fun seek(positionMs: Double) { player?.seekTo(positionMs.toLong()) }

    override fun onDetachedFromWindow() {
        mainHandler.removeCallbacks(timeRunnable)
        player?.release()
        player = null
        super.onDetachedFromWindow()
    }
}
