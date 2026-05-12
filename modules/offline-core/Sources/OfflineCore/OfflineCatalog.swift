import Foundation
import SQLite3

let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public struct OfflineTrackRow: Equatable {
    public let trackId: String
    public let deviceId: String
    public let blobPath: String
    public let sizeBytes: Int64
    public let wrappedKey: Data
    public let wrapNonce: Data
    public let trackIv: Data
    public let licenseExp: Int64
    public let licenseIat: Int64
    public let downloadedAt: Int64
    public let metaJSON: String?
    public let corrupted: Bool

    public init(trackId: String, deviceId: String, blobPath: String, sizeBytes: Int64,
                wrappedKey: Data, wrapNonce: Data, trackIv: Data,
                licenseExp: Int64, licenseIat: Int64, downloadedAt: Int64,
                metaJSON: String?, corrupted: Bool) {
        self.trackId = trackId
        self.deviceId = deviceId
        self.blobPath = blobPath
        self.sizeBytes = sizeBytes
        self.wrappedKey = wrappedKey
        self.wrapNonce = wrapNonce
        self.trackIv = trackIv
        self.licenseExp = licenseExp
        self.licenseIat = licenseIat
        self.downloadedAt = downloadedAt
        self.metaJSON = metaJSON
        self.corrupted = corrupted
    }
}

public final class OfflineCatalog {
    private var db: OpaquePointer?
    // Serializes all public method bodies for correctness against concurrent scheme
    // handler calls (WebKit background queue) and downloader queues. Performance can
    // be revisited later (e.g., WAL mode + per-method connections).
    private let queue = DispatchQueue(label: "cc.musicme.offline.catalog", qos: .userInitiated)

    public init(databaseURL: URL) throws {
        let path = databaseURL.path
        let openResult = sqlite3_open(path, &db)
        guard openResult == SQLITE_OK else {
            throw OfflineError.sqliteError("open failed: \(openResult)")
        }
        try migrate()
    }

    // Assumption: by the time deinit runs ARC has released all references, so no
    // other thread can be inside a `queue.sync` block touching `db`.
    deinit { sqlite3_close(db) }

    private func migrate() throws {
        let ddl = """
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
            );
            CREATE INDEX IF NOT EXISTS idx_license_exp ON offline_tracks(license_exp);
        """
        try exec(ddl)
    }

    public func insert(_ row: OfflineTrackRow) throws {
        try queue.sync {
            let sql = """
                INSERT OR REPLACE INTO offline_tracks
                (track_id, device_id, blob_path, size_bytes, wrapped_key, wrap_nonce, track_iv,
                 license_exp, license_iat, downloaded_at, meta_json, corrupted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw OfflineError.sqliteError("prepare insert: \(String(cString: sqlite3_errmsg(db)))")
            }
            defer { sqlite3_finalize(stmt) }

            sqlite3_bind_text(stmt, 1, row.trackId, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, row.deviceId, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 3, row.blobPath, -1, SQLITE_TRANSIENT)
            sqlite3_bind_int64(stmt, 4, row.sizeBytes)
            bindBlob(stmt, idx: 5, data: row.wrappedKey)
            bindBlob(stmt, idx: 6, data: row.wrapNonce)
            bindBlob(stmt, idx: 7, data: row.trackIv)
            sqlite3_bind_int64(stmt, 8, row.licenseExp)
            sqlite3_bind_int64(stmt, 9, row.licenseIat)
            sqlite3_bind_int64(stmt, 10, row.downloadedAt)
            if let meta = row.metaJSON {
                sqlite3_bind_text(stmt, 11, meta, -1, SQLITE_TRANSIENT)
            } else {
                sqlite3_bind_null(stmt, 11)
            }
            sqlite3_bind_int(stmt, 12, row.corrupted ? 1 : 0)

            guard sqlite3_step(stmt) == SQLITE_DONE else {
                throw OfflineError.sqliteError("insert: \(String(cString: sqlite3_errmsg(db)))")
            }
        }
    }

    public func get(trackId: String) throws -> OfflineTrackRow? {
        try queue.sync {
            let sql = "SELECT track_id, device_id, blob_path, size_bytes, wrapped_key, wrap_nonce, track_iv, license_exp, license_iat, downloaded_at, meta_json, corrupted FROM offline_tracks WHERE track_id = ?"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw OfflineError.sqliteError("prepare get")
            }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, trackId, -1, SQLITE_TRANSIENT)

            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE { return nil }
            guard step == SQLITE_ROW else { throw OfflineError.sqliteError("get step: \(step)") }
            return readRow(stmt!)
        }
    }

    public func list() throws -> [OfflineTrackRow] {
        try queue.sync {
            let sql = "SELECT track_id, device_id, blob_path, size_bytes, wrapped_key, wrap_nonce, track_iv, license_exp, license_iat, downloaded_at, meta_json, corrupted FROM offline_tracks ORDER BY downloaded_at DESC"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw OfflineError.sqliteError("prepare list")
            }
            defer { sqlite3_finalize(stmt) }
            var out: [OfflineTrackRow] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                out.append(readRow(stmt!))
            }
            return out
        }
    }

    public func remove(trackId: String) throws {
        try queue.sync {
            let sql = "DELETE FROM offline_tracks WHERE track_id = ?"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw OfflineError.sqliteError("prepare remove")
            }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, trackId, -1, SQLITE_TRANSIENT)
            guard sqlite3_step(stmt) == SQLITE_DONE else {
                throw OfflineError.sqliteError("remove step")
            }
        }
    }

    public func wipeAll() throws {
        try queue.sync {
            try exec("DELETE FROM offline_tracks")
        }
    }

    public func updateLicenseExp(trackId: String, exp: Int64, iat: Int64) throws {
        try queue.sync {
            let sql = "UPDATE offline_tracks SET license_exp = ?, license_iat = ? WHERE track_id = ?"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw OfflineError.sqliteError("prepare updateLicenseExp")
            }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_int64(stmt, 1, exp)
            sqlite3_bind_int64(stmt, 2, iat)
            sqlite3_bind_text(stmt, 3, trackId, -1, SQLITE_TRANSIENT)
            guard sqlite3_step(stmt) == SQLITE_DONE else {
                throw OfflineError.sqliteError("updateLicenseExp step")
            }
        }
    }

    public func markCorrupted(trackId: String) throws {
        try queue.sync {
            let sql = "UPDATE offline_tracks SET corrupted = 1 WHERE track_id = ?"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                throw OfflineError.sqliteError("prepare mark")
            }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, trackId, -1, SQLITE_TRANSIENT)
            guard sqlite3_step(stmt) == SQLITE_DONE else {
                throw OfflineError.sqliteError("mark step")
            }
        }
    }

    // MARK: - Internal

    private func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        let status = sqlite3_exec(db, sql, nil, nil, &err)
        if status != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(err)
            throw OfflineError.sqliteError("exec failed: \(msg)")
        }
    }

    private func bindBlob(_ stmt: OpaquePointer?, idx: Int32, data: Data) {
        data.withUnsafeBytes { ptr in
            _ = sqlite3_bind_blob(stmt, idx, ptr.baseAddress, Int32(data.count), SQLITE_TRANSIENT)
        }
    }

    private func readRow(_ stmt: OpaquePointer) -> OfflineTrackRow {
        return OfflineTrackRow(
            trackId: String(cString: sqlite3_column_text(stmt, 0)),
            deviceId: String(cString: sqlite3_column_text(stmt, 1)),
            blobPath: String(cString: sqlite3_column_text(stmt, 2)),
            sizeBytes: sqlite3_column_int64(stmt, 3),
            wrappedKey: readBlob(stmt, idx: 4),
            wrapNonce: readBlob(stmt, idx: 5),
            trackIv: readBlob(stmt, idx: 6),
            licenseExp: sqlite3_column_int64(stmt, 7),
            licenseIat: sqlite3_column_int64(stmt, 8),
            downloadedAt: sqlite3_column_int64(stmt, 9),
            metaJSON: sqlite3_column_type(stmt, 10) == SQLITE_NULL
                ? nil : String(cString: sqlite3_column_text(stmt, 10)),
            corrupted: sqlite3_column_int(stmt, 11) != 0
        )
    }

    private func readBlob(_ stmt: OpaquePointer, idx: Int32) -> Data {
        let n = Int(sqlite3_column_bytes(stmt, idx))
        guard n > 0, let ptr = sqlite3_column_blob(stmt, idx) else { return Data() }
        return Data(bytes: ptr, count: n)
    }
}
