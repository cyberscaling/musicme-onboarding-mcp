package cc.musicme.offline.expo

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import cc.musicme.offline.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.util.UUID

class OfflineExpoModule : Module() {

    private var service: OfflineService? = null

    override fun definition() = ModuleDefinition {
        Name("OfflineExpoModule")

        Events("offline:download:progress", "offline:download:complete",
               "offline:download:error", "offline:license:expired",
               "player:remote:next", "player:remote:prev")

        OnCreate {
            val ctx = appContext.reactContext ?: return@OnCreate
            val root = File(ctx.filesDir, "offline")
            service = try { OfflineService(ctx, root) } catch (e: Exception) { null }
            OfflineSingleton.service = service
        }

        OnStartObserving("player:remote:next") {
            RemoteEvents.onNext = { sendEvent("player:remote:next", emptyMap<String, Any?>()) }
        }
        OnStopObserving("player:remote:next") {
            RemoteEvents.onNext = null
        }
        OnStartObserving("player:remote:prev") {
            RemoteEvents.onPrev = { sendEvent("player:remote:prev", emptyMap<String, Any?>()) }
        }
        OnStopObserving("player:remote:prev") {
            RemoteEvents.onPrev = null
        }

        AsyncFunction("ingestDownload") { tmpPath: String, license: String, sizeBytes: Double, metaJson: String? ->
            val svc = service ?: throw IllegalStateException("OfflineService not ready")
            val tmpFile = File(Uri.parse(tmpPath).path ?: tmpPath)
            svc.ingestDownload(tmpFile, license, sizeBytes.toLong(), metaJson)
            val trackId = runCatching { LicenseClaims.decode(license).trackId }.getOrDefault("")
            sendEvent("offline:download:complete", mapOf("trackId" to trackId))
            trackId
        }

        AsyncFunction("updateLicense") { trackId: String, license: String ->
            val svc = service ?: throw IllegalStateException("OfflineService not ready")
            val claims = LicenseClaims.decode(license)
            require(claims.trackId == trackId) { "trackId mismatch" }
            svc.catalog.updateLicenseExp(trackId, claims.exp, claims.iat)
        }

        AsyncFunction("listTracks") {
            val svc = service ?: throw IllegalStateException("OfflineService not ready")
            svc.listTracks().map { rowToMap(it) }
        }

        AsyncFunction("hasTrack") { trackId: String ->
            val svc = service ?: throw IllegalStateException("OfflineService not ready")
            svc.hasTrack(trackId)
        }

        AsyncFunction("removeTrack") { trackId: String ->
            val svc = service ?: throw IllegalStateException("OfflineService not ready")
            svc.removeTrack(trackId)
        }

        AsyncFunction("wipeAll") {
            val svc = service ?: throw IllegalStateException("OfflineService not ready")
            svc.wipeAll()
        }

        AsyncFunction("getDeviceId") {
            val ctx = appContext.reactContext ?: return@AsyncFunction ""
            DeviceIdProvider.current(ctx)
        }

        AsyncFunction("configurePlayer") { workerUrl: String, token: String ->
            PlayerConfig.workerUrl = workerUrl
            PlayerConfig.currentToken = token
            PlayerConfig.tokenProvider = { PlayerConfig.currentToken ?: "" }
        }
        AsyncFunction("setStreamToken") { token: String ->
            PlayerConfig.currentToken = token
        }

        AsyncFunction("prefetch") { ref: Map<String, Int> ->
            val cb = ref["cb"] ?: return@AsyncFunction
            val disc = ref["disc"] ?: 0
            val track = ref["track"] ?: 0
            val svc = service ?: return@AsyncFunction
            val workerUrl = PlayerConfig.workerUrl ?: return@AsyncFunction
            val tokenProvider = PlayerConfig.tokenProvider ?: return@AsyncFunction
            val trackId = "$cb:$disc:$track"
            try {
                val s = svc.openSource(cc.musicme.offline.TrackRef(cb, disc, track), workerUrl, tokenProvider)
                kotlinx.coroutines.runBlocking {
                    if (s is cc.musicme.offline.StreamSource) s.prepare()
                    runCatching { s.read(0L, minOf(256L * 1024L, s.fileSize)) }
                }
                PrefetchCache.put(trackId, s)
            } catch (_: Throwable) {
                // best-effort
            }
        }

        View(NativePlayer::class) {
            Prop("trackRef") { view: NativePlayer, ref: Map<String, Int> ->
                val cb = ref["cb"] ?: return@Prop
                val disc = ref["disc"] ?: 0
                val track = ref["track"] ?: 0
                view.load(cb, disc, track)
            }
            Prop("title")    { view: NativePlayer, t: String? -> view.trackTitle = t }
            Prop("artist")   { view: NativePlayer, a: String? -> view.trackArtist = a }
            Prop("coverUrl") { view: NativePlayer, c: String? -> view.trackCoverUrl = c }
            Prop("autoPlay") { view: NativePlayer, ap: Boolean -> view.autoPlay = ap }
            Prop("playing")  { view: NativePlayer, p: Boolean -> view.setPlaying(p) }
            Prop("seekToMs") { view: NativePlayer, t: Double? -> if (t != null) view.seek(t) }
            Events("onReady","onError","onPlay","onPause","onTimeUpdate","onEnded","onStalled","onSessionRotated","onMetrics")
        }
    }

    private fun rowToMap(r: OfflineTrackRow): Map<String, Any?> {
        val meta: Map<String, Any?> = r.metaJson?.let {
            runCatching {
                val obj = JSONObject(it)
                obj.keys().asSequence().associateWith { k -> obj.opt(k) }
            }.getOrDefault(emptyMap())
        } ?: emptyMap()
        return mapOf(
            "trackId" to r.trackId,
            "mid" to 0.0,             // TODO T7: upstream OfflineTrackRow lacks `mid`. Hardcoded for now.
            "sizeBytes" to r.sizeBytes.toDouble(),
            "downloadedAt" to r.downloadedAt.toDouble(),
            "licenseExp" to r.licenseExp.toDouble(),
            "meta" to meta
        )
    }
}

object OfflineSingleton {
    @Volatile var service: OfflineService? = null
}

object DeviceIdProvider {
    private const val PREF = "cc.musicme.offline"
    private const val KEY = "deviceId"
    fun current(ctx: Context): String {
        val sp: SharedPreferences = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        sp.getString(KEY, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        sp.edit().putString(KEY, id).apply()
        return id
    }
}
