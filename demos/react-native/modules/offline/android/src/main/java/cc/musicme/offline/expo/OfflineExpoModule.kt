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
               "offline:download:error", "offline:license:expired")

        OnCreate {
            val ctx = appContext.reactContext ?: return@OnCreate
            val root = File(ctx.filesDir, "offline")
            service = try { OfflineService(ctx, root) } catch (e: Exception) { null }
            OfflineSingleton.service = service
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

        View(OfflineNativePlayer::class) {
            Prop("trackId") { view: OfflineNativePlayer, trackId: String -> view.load(trackId) }
            Prop("autoPlay") { view: OfflineNativePlayer, autoPlay: Boolean -> view.autoPlay = autoPlay }
            Prop("playing") { view: OfflineNativePlayer, playing: Boolean -> view.setPlaying(playing) }
            Prop("seekToMs") { view: OfflineNativePlayer, seekToMs: Double? ->
                if (seekToMs != null) view.seek(seekToMs)
            }
            Events("onReady", "onError", "onPlay", "onPause", "onTimeUpdate", "onEnded")
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
