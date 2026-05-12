package cc.musicme.offline

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.Closeable

data class OfflineTrackRow(
    val trackId: String,
    val deviceId: String,
    val blobPath: String,
    val sizeBytes: Long,
    val wrappedKey: ByteArray,
    val wrapNonce: ByteArray,
    val trackIv: ByteArray,
    val licenseExp: Long,
    val licenseIat: Long,
    val downloadedAt: Long,
    val metaJson: String?,
    val corrupted: Boolean
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is OfflineTrackRow) return false
        return trackId == other.trackId
            && deviceId == other.deviceId
            && blobPath == other.blobPath
            && sizeBytes == other.sizeBytes
            && wrappedKey.contentEquals(other.wrappedKey)
            && wrapNonce.contentEquals(other.wrapNonce)
            && trackIv.contentEquals(other.trackIv)
            && licenseExp == other.licenseExp
            && licenseIat == other.licenseIat
            && downloadedAt == other.downloadedAt
            && metaJson == other.metaJson
            && corrupted == other.corrupted
    }
    override fun hashCode(): Int {
        var r = trackId.hashCode()
        r = 31 * r + deviceId.hashCode()
        r = 31 * r + blobPath.hashCode()
        r = 31 * r + sizeBytes.hashCode()
        r = 31 * r + wrappedKey.contentHashCode()
        r = 31 * r + wrapNonce.contentHashCode()
        r = 31 * r + trackIv.contentHashCode()
        r = 31 * r + licenseExp.hashCode()
        r = 31 * r + licenseIat.hashCode()
        r = 31 * r + downloadedAt.hashCode()
        r = 31 * r + (metaJson?.hashCode() ?: 0)
        r = 31 * r + corrupted.hashCode()
        return r
    }
}

class OfflineCatalog(context: Context, dbPath: String) : Closeable {
    private val helper: Helper = Helper(context, dbPath)
    private val lock = Any()

    init {
        // Force DB creation + onCreate() schema application at construction time.
        helper.writableDatabase
    }

    private class Helper(context: Context, dbPath: String)
        : SQLiteOpenHelper(context, dbPath, null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS offline_tracks (
                  track_id      TEXT PRIMARY KEY,
                  device_id     TEXT NOT NULL,
                  blob_path     TEXT NOT NULL,
                  size_bytes    INTEGER NOT NULL,
                  wrapped_key   BLOB NOT NULL,
                  wrap_nonce    BLOB NOT NULL,
                  track_iv      BLOB NOT NULL,
                  license_exp   INTEGER NOT NULL,
                  license_iat   INTEGER NOT NULL,
                  downloaded_at INTEGER NOT NULL,
                  meta_json     TEXT,
                  corrupted     INTEGER DEFAULT 0
                )
            """.trimIndent())
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_license_exp ON offline_tracks(license_exp)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldV: Int, newV: Int) {
            // No-op for v1
        }
    }

    fun insert(row: OfflineTrackRow) = synchronized(lock) {
        val db = helper.writableDatabase
        val cv = ContentValues().apply {
            put("track_id", row.trackId)
            put("device_id", row.deviceId)
            put("blob_path", row.blobPath)
            put("size_bytes", row.sizeBytes)
            put("wrapped_key", row.wrappedKey)
            put("wrap_nonce", row.wrapNonce)
            put("track_iv", row.trackIv)
            put("license_exp", row.licenseExp)
            put("license_iat", row.licenseIat)
            put("downloaded_at", row.downloadedAt)
            put("meta_json", row.metaJson)
            put("corrupted", if (row.corrupted) 1 else 0)
        }
        val rowsAffected = db.insertWithOnConflict("offline_tracks", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        if (rowsAffected < 0) throw OfflineError.SqliteError("insert returned $rowsAffected")
    }

    fun get(trackId: String): OfflineTrackRow? = synchronized(lock) {
        helper.readableDatabase.query(
            "offline_tracks", null, "track_id = ?", arrayOf(trackId), null, null, null
        ).use { c ->
            return if (c.moveToFirst()) readRow(c) else null
        }
    }

    fun list(): List<OfflineTrackRow> = synchronized(lock) {
        val out = mutableListOf<OfflineTrackRow>()
        helper.readableDatabase.query(
            "offline_tracks", null, null, null, null, null, "downloaded_at DESC"
        ).use { c ->
            while (c.moveToNext()) out.add(readRow(c))
        }
        return out
    }

    fun remove(trackId: String) = synchronized(lock) {
        helper.writableDatabase.delete("offline_tracks", "track_id = ?", arrayOf(trackId))
    }

    fun wipeAll() = synchronized(lock) {
        helper.writableDatabase.delete("offline_tracks", null, null)
    }

    fun markCorrupted(trackId: String) = synchronized(lock) {
        val cv = ContentValues().apply { put("corrupted", 1) }
        helper.writableDatabase.update("offline_tracks", cv, "track_id = ?", arrayOf(trackId))
    }

    fun updateLicenseExp(trackId: String, exp: Long, iat: Long) = synchronized(lock) {
        val cv = ContentValues().apply {
            put("license_exp", exp)
            put("license_iat", iat)
        }
        helper.writableDatabase.update("offline_tracks", cv, "track_id = ?", arrayOf(trackId))
    }

    override fun close() { helper.close() }

    private fun readRow(c: Cursor): OfflineTrackRow = OfflineTrackRow(
        trackId = c.getString(c.getColumnIndexOrThrow("track_id")),
        deviceId = c.getString(c.getColumnIndexOrThrow("device_id")),
        blobPath = c.getString(c.getColumnIndexOrThrow("blob_path")),
        sizeBytes = c.getLong(c.getColumnIndexOrThrow("size_bytes")),
        wrappedKey = c.getBlob(c.getColumnIndexOrThrow("wrapped_key")),
        wrapNonce = c.getBlob(c.getColumnIndexOrThrow("wrap_nonce")),
        trackIv = c.getBlob(c.getColumnIndexOrThrow("track_iv")),
        licenseExp = c.getLong(c.getColumnIndexOrThrow("license_exp")),
        licenseIat = c.getLong(c.getColumnIndexOrThrow("license_iat")),
        downloadedAt = c.getLong(c.getColumnIndexOrThrow("downloaded_at")),
        metaJson = if (c.isNull(c.getColumnIndexOrThrow("meta_json"))) null
                   else c.getString(c.getColumnIndexOrThrow("meta_json")),
        corrupted = c.getInt(c.getColumnIndexOrThrow("corrupted")) != 0
    )
}
