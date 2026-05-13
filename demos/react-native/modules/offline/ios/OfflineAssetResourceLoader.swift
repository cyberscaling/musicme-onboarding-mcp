import AVFoundation
import Foundation

/// Routes AVAsset resource loading requests to a `ByteSource`. URL scheme:
/// `sasplayer://<trackId>/audio.m4a` — the trackId is unused by this class
/// (resolution happens at construction); kept for AVFoundation's URL handling.
class SasPlayerResourceLoader: NSObject, AVAssetResourceLoaderDelegate {
    static let scheme = "sasplayer"

    private let source: ByteSource
    private let workQueue = DispatchQueue(label: "cc.musicme.sasplayer.loader")

    init(source: ByteSource) {
        self.source = source
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        workQueue.async {
            Task {
                await self.serve(loadingRequest)
            }
        }
        return true
    }

    private func serve(_ loadingRequest: AVAssetResourceLoadingRequest) async {
        do {
            // StreamSource needs a bootstrap before fileSize is known.
            if let ss = source as? StreamSource { try await ss.prepare() }

            if let info = loadingRequest.contentInformationRequest {
                info.contentType = AVFileType.m4a.rawValue
                info.contentLength = source.fileSize
                info.isByteRangeAccessSupported = true
            }
            guard let dataRequest = loadingRequest.dataRequest else {
                loadingRequest.finishLoading()
                return
            }

            let start = dataRequest.requestedOffset
            let length = dataRequest.requestedLength
            let remaining = source.fileSize - start
            let clamped = min(Int64(length), max(remaining, 0))
            let endExclusive = start + clamped

            // Stream the data in 256KB slabs to keep memory low and start
            // delivering bytes earlier.
            let slabSize: Int64 = 256 * 1024
            var cursor = start
            while cursor < endExclusive {
                let next = min(cursor + slabSize, endExclusive)
                let chunk = try await source.read(range: cursor..<next)
                dataRequest.respond(with: chunk)
                cursor = next
            }
            loadingRequest.finishLoading()
        } catch {
            loadingRequest.finishLoading(with: error)
        }
    }
}
