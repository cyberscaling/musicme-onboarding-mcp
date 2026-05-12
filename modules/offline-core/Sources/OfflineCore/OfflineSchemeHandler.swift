import Foundation
import WebKit

/// Handles `offline://<trackId>/audio.m4a` Range-aware reads. Trust chain:
/// 1. URL host -> trackId.
/// 2. Catalog lookup. Missing → 404.
/// 3. `device_id` must equal current `deviceIdProvider()`. Mismatch → 403 + DELETE row.
/// 4. `license_exp` not in the past. Expired → 410.
/// 5. Unwrap trackKey via KeyVault. Failure → 410 (treat as license unusable).
/// 6. Parse `Range` header (`bytes=A-B` or `bytes=A-`). Out of bounds → 416.
/// 7. Block-align A → A_aligned = floor(A/16)*16. counter = aligned/16.
/// 8. pread blob[A_aligned..B]. AES-CTR decrypt with counter. Slice from (A - A_aligned).
/// 9. Respond 200 (no Range) or 206 (Range) with Content-Length set to slice length.
public final class OfflineSchemeHandler: NSObject, WKURLSchemeHandler {
    public static let scheme = "offline"
    public static let blockSize = 16

    private let catalog: OfflineCatalog
    private let blobStore: BlobStore
    private let keyVault: KeyVault
    private let deviceIdProvider: () -> String

    public init(catalog: OfflineCatalog, blobStore: BlobStore, keyVault: KeyVault,
                deviceIdProvider: @escaping () -> String) {
        self.catalog = catalog
        self.blobStore = blobStore
        self.keyVault = keyVault
        self.deviceIdProvider = deviceIdProvider
    }

    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        let trackId = url.host ?? ""
        let rangeHeader = urlSchemeTask.request.value(forHTTPHeaderField: "Range")

        do {
            try handle(trackId: trackId, rangeHeader: rangeHeader, task: urlSchemeTask, url: url)
        } catch let err as OfflineError {
            respondError(err, task: urlSchemeTask, url: url)
        } catch {
            respond(status: 500, headers: [:], body: Data(), task: urlSchemeTask, url: url)
        }
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No-op: synchronous handler. Cancellation handled by WebKit.
    }

    // MARK: - Pipeline

    private func handle(trackId: String, rangeHeader: String?, task: WKURLSchemeTask, url: URL) throws {
        guard let row = try catalog.get(trackId: trackId) else {
            respond(status: 404, headers: [:], body: Data(), task: task, url: url)
            return
        }

        let currentDevice = deviceIdProvider()
        if row.deviceId != currentDevice {
            try catalog.remove(trackId: trackId)
            try? blobStore.delete(trackId: trackId)
            respond(status: 403, headers: [:], body: Data(), task: task, url: url)
            return
        }

        let now = Int64(Date().timeIntervalSince1970)
        if row.licenseExp < now {
            respond(status: 410, headers: [:], body: Data(), task: task, url: url)
            return
        }

        var trackKey: Data
        do {
            trackKey = try keyVault.unwrap(ciphertext: row.wrappedKey, nonce: row.wrapNonce)
        } catch {
            respond(status: 410, headers: [:], body: Data(), task: task, url: url)
            return
        }
        defer {
            // Best-effort zeroize on exit. CryptoKit/CommonCrypto may have already made
            // internal copies; this only zeroes our local buffer.
            trackKey.withUnsafeMutableBytes { ptr in
                memset(ptr.baseAddress, 0, ptr.count)
            }
        }

        let (start, end, isRangeRequest) = try parseRange(header: rangeHeader, fileSize: row.sizeBytes)

        let alignedStart = (start / Int64(Self.blockSize)) * Int64(Self.blockSize)
        let skip = Int(start - alignedStart)
        let wireLength = Int(end - alignedStart + 1)
        let blockIndex = Int(alignedStart / Int64(Self.blockSize))

        let ciphertextSlice = try blobStore.pread(path: row.blobPath, offset: alignedStart, length: wireLength)
        guard ciphertextSlice.count == wireLength else {
            try catalog.markCorrupted(trackId: trackId)
            respond(status: 500, headers: [:], body: Data(), task: task, url: url)
            return
        }

        let plaintextAligned = try AESCTRDecryptor.decrypt(
            ciphertext: ciphertextSlice, key: trackKey, baseIv: row.trackIv, blockIndex: blockIndex
        )
        let userPlaintext = plaintextAligned.subdata(in: skip..<plaintextAligned.count)

        var headers: [String: String] = [
            "Content-Type": "audio/mp4",
            "Content-Length": String(userPlaintext.count),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store, private",
        ]
        let status: Int
        if isRangeRequest {
            status = 206
            headers["Content-Range"] = "bytes \(start)-\(end)/\(row.sizeBytes)"
        } else {
            status = 200
        }
        respond(status: status, headers: headers, body: userPlaintext, task: task, url: url)
    }

    private func parseRange(header: String?, fileSize: Int64) throws -> (start: Int64, end: Int64, isRangeRequest: Bool) {
        guard let header = header else { return (0, fileSize - 1, false) }
        let trimmed = header.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("bytes=") else { throw OfflineError.rangeOutOfBounds }
        let rest = trimmed.dropFirst("bytes=".count)
        let parts = rest.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, let start = Int64(parts[0]) else {
            throw OfflineError.rangeOutOfBounds
        }
        let end: Int64
        if parts[1].isEmpty {
            end = fileSize - 1
        } else {
            guard let e = Int64(parts[1]) else { throw OfflineError.rangeOutOfBounds }
            end = e
        }
        guard start >= 0, end < fileSize, start <= end else {
            throw OfflineError.rangeOutOfBounds
        }
        return (start, end, true)
    }

    private func respondError(_ err: OfflineError, task: WKURLSchemeTask, url: URL) {
        let status: Int
        switch err {
        case .rangeOutOfBounds: status = 416
        case .trackNotFound:    status = 404
        case .deviceIdMismatch: status = 403
        case .licenseExpired, .keyUnwrapFailed: status = 410
        case .blobCorrupted: status = 500
        default: status = 500
        }
        respond(status: status, headers: [:], body: Data(), task: task, url: url)
    }

    private func respond(status: Int, headers: [String: String], body: Data,
                         task: WKURLSchemeTask, url: URL) {
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers
        )!
        task.didReceive(response)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }
}
