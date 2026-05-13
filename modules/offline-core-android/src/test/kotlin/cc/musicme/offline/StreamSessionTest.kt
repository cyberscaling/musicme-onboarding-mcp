package cc.musicme.offline

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.Base64

class StreamSessionTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient

    @Before fun setup() {
        server = MockWebServer().apply { start() }
        client = OkHttpClient()
    }
    @After fun teardown() { server.shutdown() }

    @Test fun bootstrap_returns_session_key_iv_filesize() = runTest {
        server.enqueue(MockResponse()
            .setHeader("Content-Type", "application/json")
            .setBody(okInitJson("sid-1")))
        val session = StreamSession(server.url("/").toString(), { "tok" },
            TrackRef(1, 0, 1), client)
        val boot = session.bootstrap()
        assertEquals("sid-1", boot.sessionId)
        assertEquals(16L, boot.fileSize)
        assertEquals(32, boot.key.size)
        assertEquals(16, boot.iv.size)
        assertEquals("audio/mp4", boot.contentType)
    }

    @Test fun bootstrap_401_refreshes_token_and_retries_once() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson()))
        val tokens = mutableListOf("expired", "fresh")
        val session = StreamSession(server.url("/").toString(),
            { tokens.removeAt(0) }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        assertTrue(tokens.isEmpty())
    }

    @Test(expected = OfflineError.SessionUnauthorized::class)
    fun bootstrap_second_401_propagates() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))
        val session = StreamSession(server.url("/").toString(),
            { "bad" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
    }

    @Test fun read_410_reinitializes_session() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson("sid-old")))
        server.enqueue(MockResponse().setResponseCode(410))
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson("sid-new")))
        // 16 bytes of ciphertext that decrypts to whatever AES-CTR produces under the test key/iv.
        val zeroBuf = Buffer().write(ByteArray(16))
        server.enqueue(MockResponse()
            .setHeader("Content-Range", "bytes 0-15/16")
            .setHeader("X-Counter-Start", "0")
            .setHeader("X-Skip-Bytes", "0")
            .setResponseCode(206)
            .setBody(zeroBuf))
        val session = StreamSession(server.url("/").toString(), { "tok" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        val data = session.read(0L, 16L)
        assertEquals(16, data.size)
    }

    @Test(expected = OfflineError.SessionFingerprintMismatch::class)
    fun read_403_is_fatal() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson()))
        server.enqueue(MockResponse().setResponseCode(403))
        val session = StreamSession(server.url("/").toString(), { "tok" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        session.read(0L, 16L)
    }

    @Test fun heartbeat_200_returns_true() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson()))
        server.enqueue(MockResponse().setBody("{\"ok\":true,\"duration_ms\":0,\"event_emitted\":null}"))
        val session = StreamSession(server.url("/").toString(), { "tok" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        assertTrue(session.heartbeat())
    }

    @Test fun heartbeat_410_returns_false() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson()))
        server.enqueue(MockResponse().setResponseCode(410))
        val session = StreamSession(server.url("/").toString(), { "tok" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        assertFalse(session.heartbeat())
    }

    @Test fun metrics_captured_after_bootstrap_and_read() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson()))
        val buf = okio.Buffer().write(ByteArray(16))
        server.enqueue(MockResponse()
            .setHeader("Content-Range", "bytes 0-15/16")
            .setHeader("X-Counter-Start", "0")
            .setHeader("X-Skip-Bytes", "0")
            .setResponseCode(206).setBody(buf))
        val session = StreamSession(server.url("/").toString(), { "tok" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        session.read(0L, 16L)
        val m = session.metrics()
        assertNotNull(m.bootstrapMs)
        assertNotNull(m.firstRangeMs)
        assertNotNull(m.firstDecryptMs)
        assertEquals(16L, m.fileSizeBytes)
        assertEquals(0, m.sessionRotations)
    }

    @Test fun session_rotations_increments_on_410() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson("sid-old")))
        server.enqueue(MockResponse().setResponseCode(410))
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody(okInitJson("sid-new")))
        val buf = okio.Buffer().write(ByteArray(16))
        server.enqueue(MockResponse()
            .setHeader("Content-Range", "bytes 0-15/16")
            .setHeader("X-Counter-Start", "0")
            .setHeader("X-Skip-Bytes", "0")
            .setResponseCode(206).setBody(buf))
        val session = StreamSession(server.url("/").toString(), { "tok" }, TrackRef(1, 0, 1), client)
        session.bootstrap()
        session.read(0L, 16L)
        val m = session.metrics()
        assertEquals(1, m.sessionRotations)
    }

    private fun okInitJson(sessionId: String = "sid-1"): String {
        val key = Base64.getEncoder().encodeToString(ByteArray(32) { 0xAA.toByte() })
        val iv = Base64.getEncoder().encodeToString(ByteArray(16) { 0xBB.toByte() })
        return """{"sessionId":"$sessionId","fileSize":16,"contentType":"audio/mp4",
                  "streamUrl":"/stream/$sessionId","keyUrl":"/key/$sessionId","expiresAt":0,
                  "keyB64":"$key","ivB64":"$iv"}"""
    }
}
