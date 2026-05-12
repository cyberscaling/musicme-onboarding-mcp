import AVFoundation
import Foundation

/// Bridges AVPlayer's ranged loading to the OfflineCore decryption pipeline.
class OfflineAssetResourceLoader: NSObject, AVAssetResourceLoaderDelegate {
    static let scheme = "offline-asset"

    private let service: OfflineService
    private let deviceIdProvider: () -> String

    init(service: OfflineService, deviceIdProvider: @escaping () -> String) {
        self.service = service
        self.deviceIdProvider = deviceIdProvider
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard let url = loadingRequest.request.url,
              let host = url.host?.removingPercentEncoding else {
            loadingRequest.finishLoading(with: NSError(domain: "OfflineAsset", code: 400))
            return true
        }

        DispatchQueue.global(qos: .userInitiated).async {
            self.serve(trackId: host, loadingRequest: loadingRequest)
        }
        return true
    }

    private func serve(trackId: String, loadingRequest: AVAssetResourceLoadingRequest) {
        do {
            guard let row = try service.catalog.get(trackId: trackId) else {
                throw OfflineError.trackNotFound
            }

            if row.deviceId != deviceIdProvider() {
                try service.catalog.remove(trackId: trackId)
                try? service.blobStore.delete(trackId: trackId)
                throw OfflineError.deviceIdMismatch
            }

            let now = Int64(Date().timeIntervalSince1970)
            if row.licenseExp < now {
                throw OfflineError.licenseExpired
            }

            if let info = loadingRequest.contentInformationRequest {
                info.contentType = AVFileType.m4a.rawValue
                info.contentLength = row.sizeBytes
                info.isByteRangeAccessSupported = true
            }

            guard let dataRequest = loadingRequest.dataRequest else {
                loadingRequest.finishLoading()
                return
            }

            let start = dataRequest.requestedOffset
            let length = dataRequest.requestedLength
            // `requestedLength` is `Int.max` for open-ended requests, which
            // overflows `start + Int64(length) - 1`. Clamp against remaining
            // file size before computing `end`.
            let remaining = row.sizeBytes - start
            let clampedLength = min(Int64(length), remaining)
            let end = start + clampedLength - 1

            let alignedStart = (start / 16) * 16
            let skip = Int(start - alignedStart)
            let wireLength = Int(end - alignedStart + 1)
            let blockIndex = Int(alignedStart / 16)

            var trackKey = try service.keyVault.unwrap(
                ciphertext: row.wrappedKey, nonce: row.wrapNonce
            )
            defer {
                trackKey.withUnsafeMutableBytes { ptr in
                    memset(ptr.baseAddress, 0, ptr.count)
                }
            }

            let ciphertext = try service.blobStore.pread(
                path: row.blobPath, offset: alignedStart, length: wireLength
            )
            let aligned = try AESCTRDecryptor.decrypt(
                ciphertext: ciphertext, key: trackKey, baseIv: row.trackIv, blockIndex: blockIndex
            )
            let userPlaintext = aligned.subdata(in: skip..<aligned.count)

            dataRequest.respond(with: userPlaintext)
            loadingRequest.finishLoading()
        } catch {
            loadingRequest.finishLoading(with: error)
        }
    }
}
