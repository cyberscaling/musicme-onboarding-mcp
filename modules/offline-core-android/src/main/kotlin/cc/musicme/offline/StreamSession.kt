package cc.musicme.offline

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Base64

data class TrackRef(val cb: Long, val disc: Int, val track: Int)

data class SessionMetrics(
    val bootstrapMs: Double?,
    val firstRangeMs: Double?,
    val firstDecryptMs: Double?,
    val fileSizeBytes: Long?,
    val sessionRotations: Int,
)

class StreamSession(
    private val workerUrl: String,
    private val tokenProvider: suspend () -> String,
    private val trackRef: TrackRef,
    private val client: OkHttpClient = OkHttpClient(),
) {
    data class Bootstrap(
        val sessionId: String,
        val fileSize: Long,
        val key: ByteArray,
        val iv: ByteArray,
        val contentType: String,
    )

    private val mutex = Mutex()
    @Volatile private var cached: Bootstrap? = null

    @Volatile private var bootstrapMs: Double? = null
    @Volatile private var firstRangeMs: Double? = null
    @Volatile private var firstDecryptMs: Double? = null
    @Volatile private var fileSizeBytes: Long? = null
    private val sessionRotations = java.util.concurrent.atomic.AtomicInteger(0)

    fun metrics(): SessionMetrics = SessionMetrics(
        bootstrapMs, firstRangeMs, firstDecryptMs, fileSizeBytes, sessionRotations.get()
    )

    suspend fun bootstrap(): Bootstrap {
        cached?.let { return it }
        // Single-flight: only one bootstrap at a time. Concurrent callers wait on the
        // mutex then read the fresh cache (re-check inside the lock). Prevents the
        // double-bootstrap that leaked an /init-stream session server-side.
        return mutex.withLock {
            cached ?: runBootstrap(allowRetry = true).also { cached = it }
        }
    }

    suspend fun read(start: Long, endExclusive: Long): ByteArray {
        val boot = bootstrap()
        return try {
            runRead(start, endExclusive, boot)
        } catch (e: OfflineError.StreamRangeFailed) {
            if (e.status == 410) {
                sessionRotations.incrementAndGet()
                mutex.withLock { cached = null }
                val fresh = bootstrap()
                runRead(start, endExclusive, fresh)
            } else throw e
        }
    }

    suspend fun heartbeat(): Boolean {
        val boot = mutex.withLock { cached } ?: return false
        val url = joinUrl(workerUrl, "heartbeat/${boot.sessionId}")
        val req = Request.Builder().url(url)
            .post("{\"duration_ms\":0}".toRequestBody())
            .header("Content-Type", "application/json")
            .build()
        return withContext(Dispatchers.IO) {
            val call = client.newCall(req)
            try {
                call.execute().use { r ->
                    when (r.code) {
                        200 -> true
                        410 -> false
                        else -> throw OfflineError.StreamRangeFailed(r.code)
                    }
                }
            } finally {
                call.cancel()
            }
        }
    }

    fun close() {
        // Synchronous nuke of cache. Mutex is fine to skip — losing a torn
        // read here at worst forces an extra bootstrap on the next op.
        cached = null
    }

    // --- private ---

    private suspend fun runBootstrap(allowRetry: Boolean): Bootstrap {
        val t0 = System.nanoTime()
        val token = tokenProvider()
        val body = """{"cb":${trackRef.cb},"disc":${trackRef.disc},"track":${trackRef.track}}"""
        val req = Request.Builder()
            .url(joinUrl(workerUrl, "init-stream"))
            .post(body.toRequestBody())
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .build()
        val boot = withContext(Dispatchers.IO) {
            val call = client.newCall(req)
            try {
                call.execute().use { r ->
                    when (r.code) {
                        401 -> if (allowRetry) runBootstrapInner() else throw OfflineError.SessionUnauthorized
                        200 -> parseBootstrap(r.body!!.string())
                        else -> throw OfflineError.SessionInitFailed(r.code)
                    }
                }
            } finally {
                call.cancel()
            }
        }
        // Record only on the outermost successful call (allowRetry == true means top-level).
        // The recursive inner call (allowRetry == false) also records if it succeeds,
        // but "first write wins" via the null-check.
        if (bootstrapMs == null) bootstrapMs = (System.nanoTime() - t0) / 1_000_000.0
        fileSizeBytes = boot.fileSize
        return boot
    }
    private suspend fun runBootstrapInner(): Bootstrap = runBootstrap(allowRetry = false)

    private fun parseBootstrap(text: String): Bootstrap {
        try {
            fun str(key: String): String =
                Regex(""""$key"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1)
                    ?: error("missing $key")
            fun long(key: String): Long =
                Regex(""""$key"\s*:\s*(\d+)""").find(text)?.groupValues?.get(1)?.toLong()
                    ?: error("missing $key")
            return Bootstrap(
                sessionId = str("sessionId"),
                fileSize = long("fileSize"),
                key = Base64.getDecoder().decode(str("keyB64")),
                iv = Base64.getDecoder().decode(str("ivB64")),
                contentType = str("contentType"),
            )
        } catch (e: Exception) {
            throw OfflineError.StreamMalformedResponse("init-stream")
        }
    }

    private suspend fun runRead(start: Long, endExclusive: Long, boot: Bootstrap): ByteArray {
        val aligned = (start / 16) * 16
        val endInclusive = endExclusive - 1
        val url = joinUrl(workerUrl, "stream/${boot.sessionId}")

        var lastError: Throwable? = null
        for (attempt in 0..2) {
            try {
                val tStart = System.nanoTime()
                val req = Request.Builder().url(url)
                    .header("Range", "bytes=$aligned-$endInclusive")
                    .build()
                return withContext(Dispatchers.IO) {
                    val call = client.newCall(req)
                    try {
                        call.execute().use { r ->
                            when {
                                r.code == 410 -> throw OfflineError.StreamRangeFailed(410)
                                r.code == 403 -> throw OfflineError.SessionFingerprintMismatch
                                r.code == 429 || r.code >= 500 -> throw OfflineError.StreamRangeFailed(r.code)
                                r.code !in setOf(200, 206) -> throw OfflineError.StreamRangeFailed(r.code)
                                else -> {
                                    val cipher = r.body!!.bytes()
                                    if (firstRangeMs == null) firstRangeMs = (System.nanoTime() - tStart) / 1_000_000.0
                                    // Always request from `aligned` (16-aligned): the server serves
                                    // [aligned..endInclusive], so the decrypted plaintext maps to that
                                    // same range. To return [start..endExclusive) we must drop the first
                                    // `start-aligned` bytes. The server's X-Skip-Bytes header is always 0
                                    // (it serves from the requested range), so we compute the skip
                                    // locally. The CTR counter is aligned/16 (the 16-byte block number
                                    // containing `aligned`). The web SDK avoided the bug by only ever
                                    // requesting 16-aligned starts (256 KiB chunks).
                                    val skip = (start - aligned).toInt()
                                    val counter = (aligned / 16).toInt()
                                    val tDec = System.nanoTime()
                                    val plain = AESCTRDecryptor.decrypt(cipher, boot.key, boot.iv, counter)
                                    if (firstDecryptMs == null) firstDecryptMs = (System.nanoTime() - tDec) / 1_000_000.0
                                    val wanted = (endExclusive - start).toInt()
                                    val to = minOf(skip + wanted, plain.size)
                                    plain.copyOfRange(skip, to)
                                }
                            }
                        }
                    } finally {
                        call.cancel()
                    }
                }
            } catch (e: OfflineError.StreamRangeFailed) {
                if (e.status == 410 || e.status == 403) throw e
                lastError = e
                delay(listOf(500L, 1_000L, 2_000L)[attempt])
            } catch (e: OfflineError.SessionFingerprintMismatch) {
                throw e
            } catch (e: Exception) {
                lastError = e
                delay(listOf(500L, 1_000L, 2_000L)[attempt])
            }
        }
        throw OfflineError.StreamNetworkExhausted(lastError?.message ?: "unknown")
    }

    private fun joinUrl(base: String, path: String): String {
        val b = base.trimEnd('/')
        val p = path.trimStart('/')
        return "$b/$p"
    }
}
