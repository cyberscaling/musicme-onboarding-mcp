package cc.musicme.offline.expo

import android.content.Context
import android.content.Intent
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat

class MediaSessionController(private val context: Context) {

    private var session: MediaSessionCompat? = null
    private var onPlay: () -> Unit = {}
    private var onPause: () -> Unit = {}
    private var onNext: () -> Unit = {}
    private var onPrev: () -> Unit = {}
    private var onSeek: (Long) -> Unit = {}

    fun activate(
        title: String,
        artist: String?,
        coverUrl: String?,
        onPlay: () -> Unit, onPause: () -> Unit,
        onNext: () -> Unit, onPrev: () -> Unit,
        onSeek: (Long) -> Unit,
    ) {
        this.onPlay = onPlay; this.onPause = onPause
        this.onNext = onNext; this.onPrev = onPrev
        this.onSeek = onSeek

        val s = session ?: MediaSessionCompat(context, "musicme-rn").also { session = it }
        s.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist ?: "")
                .build()
        )
        s.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() { this@MediaSessionController.onPlay() }
            override fun onPause() { this@MediaSessionController.onPause() }
            override fun onSkipToNext() { this@MediaSessionController.onNext() }
            override fun onSkipToPrevious() { this@MediaSessionController.onPrev() }
            override fun onSeekTo(pos: Long) { this@MediaSessionController.onSeek(pos) }
        })
        s.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE
                    or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    or PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                .build()
        )
        s.isActive = true

        if (coverUrl != null) loadCoverInto(coverUrl, title, artist)

        context.startForegroundService(Intent(context, MediaService::class.java).apply {
            putExtra("title", title); putExtra("artist", artist ?: "")
        })
    }

    private fun loadCoverInto(url: String, title: String, artist: String?) {
        Thread {
            try {
                val bytes = java.net.URL(url).openStream().use { it.readBytes() }
                val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    session?.setMetadata(
                        MediaMetadataCompat.Builder()
                            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist ?: "")
                            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp)
                            .build()
                    )
                }
            } catch (_: Throwable) {}
        }.start()
    }

    fun setPlaybackState(playing: Boolean, positionMs: Long) {
        session?.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE
                    or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    or PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(
                    if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                    positionMs, 1f
                ).build()
        )
    }

    fun release() {
        session?.isActive = false
        session?.release()
        session = null
        context.stopService(Intent(context, MediaService::class.java))
    }
}
