package cc.musicme.offline

import okhttp3.OkHttpClient

class StreamSource(
    workerUrl: String,
    tokenProvider: suspend () -> String,
    trackRef: TrackRef,
    client: OkHttpClient = OkHttpClient(),
) : ByteSource {

    private val session = StreamSession(workerUrl, tokenProvider, trackRef, client)
    private var bootstrapped = false
    override var fileSize: Long = 0
        private set
    override var contentType: String = "audio/mp4"
        private set

    suspend fun prepare() {
        if (bootstrapped) return
        val b = session.bootstrap()
        fileSize = b.fileSize
        contentType = b.contentType
        bootstrapped = true
    }

    override suspend fun read(start: Long, endExclusive: Long): ByteArray {
        if (!bootstrapped) prepare()
        return session.read(start, endExclusive)
    }

    suspend fun heartbeat(): Boolean = session.heartbeat()
    fun metrics(): SessionMetrics = session.metrics()
    override fun close() { session.close() }
}
