import Foundation
import AVFoundation
import OfflineCore

public final class SecureStreamLoader: NSObject, AVAssetResourceLoaderDelegate, @unchecked Sendable {
    private let session: StreamSession
    private var jwt: String
    private let streamWorkerURL: URL
    private let urlSession: URLSession
    private let refreshJWT: @Sendable () async throws -> String
    private let queue = DispatchQueue(label: "cc.musicme.sasdemo.ios.secure-stream")
    private var inflight: [ObjectIdentifier: Task<Void, Never>] = [:]

    public init(
        session: StreamSession,
        jwt: String,
        streamWorkerURL: URL,
        urlSession: URLSession = .shared,
        refreshJWT: @escaping @Sendable () async throws -> String
    ) {
        self.session = session
        self.jwt = jwt
        self.streamWorkerURL = streamWorkerURL
        self.urlSession = urlSession
        self.refreshJWT = refreshJWT
    }

    public func resourceLoader(
        _ loader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource req: AVAssetResourceLoadingRequest
    ) -> Bool {
        if let info = req.contentInformationRequest {
            // UTI required by AVAssetResourceLoadingContentInformationRequest; MIME strings fail silently.
            info.contentType = AVFileType.mp4.rawValue   // "public.mpeg-4"
            info.contentLength = Int64(session.fileSize)
            info.isByteRangeAccessSupported = true
        }
        guard let dataReq = req.dataRequest else {
            req.finishLoading()
            return true
        }
        let start = Int(dataReq.requestedOffset)
        let length = dataReq.requestedLength
        let end = start + length - 1

        let workerURL = streamWorkerURL
        let urlSession = urlSession
        let stream = session
        let jwt = jwt
        let refresh = refreshJWT
        let key = ObjectIdentifier(req)

        let task = Task.detached { [weak self] in
            do {
                let payload = try await SecureStreamLoader.fetchRange(
                    start: start, end: end,
                    session: stream, jwt: jwt,
                    streamWorkerURL: workerURL,
                    urlSession: urlSession,
                    refreshJWT: refresh
                )
                if Task.isCancelled { return }
                dataReq.respond(with: payload)
                req.finishLoading()
            } catch {
                req.finishLoading(with: error)
            }
            await self?.removeInflight(key)
        }
        queue.sync { inflight[key] = task }
        return true
    }

    public func resourceLoader(
        _ loader: AVAssetResourceLoader,
        didCancel req: AVAssetResourceLoadingRequest
    ) {
        let key = ObjectIdentifier(req)
        queue.sync {
            inflight[key]?.cancel()
            inflight[key] = nil
        }
    }

    private func removeInflight(_ key: ObjectIdentifier) async {
        queue.sync { inflight[key] = nil }
    }

    /// Pure async function — testable without AVFoundation.
    public static func fetchRange(
        start: Int, end: Int,
        session: StreamSession, jwt: String,
        streamWorkerURL: URL,
        urlSession: URLSession,
        refreshJWT: @Sendable () async throws -> String
    ) async throws -> Data {
        func makeRequest(token: String) -> URLRequest {
            var req = URLRequest(url: streamWorkerURL.appendingPathComponent("stream/\(session.sessionId)"))
            req.httpMethod = "GET"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
            return req
        }

        var token = jwt
        var attempts = 0
        while attempts < 2 {
            attempts += 1
            let req = makeRequest(token: token)
            let data: Data
            let resp: URLResponse
            do { (data, resp) = try await urlSession.data(for: req) }
            catch { throw PlaybackError.streamFetch(message: error.localizedDescription) }
            let http = resp as! HTTPURLResponse
            if http.statusCode == 401 {
                if attempts >= 2 { throw PlaybackError.sessionExpired }
                token = try await refreshJWT()
                continue
            }
            if http.statusCode == 416 {
                return Data()  // end-of-stream
            }
            guard (200..<300).contains(http.statusCode) else {
                throw PlaybackError.streamFetch(message: "HTTP \(http.statusCode)")
            }
            let counterStart = Int(http.value(forHTTPHeaderField: "X-Counter-Start") ?? "0") ?? 0
            let skipBytes = Int(http.value(forHTTPHeaderField: "X-Skip-Bytes") ?? "0") ?? 0
            let plain: Data
            do {
                plain = try OfflineCore.AESCTRDecryptor.decrypt(
                    ciphertext: data, key: session.key, baseIv: session.baseIv,
                    blockIndex: counterStart
                )
            } catch {
                throw PlaybackError.decrypt(message: error.localizedDescription)
            }
            if skipBytes > 0 && skipBytes < plain.count {
                return plain.subdata(in: skipBytes..<plain.count)
            }
            return plain
        }
        // Defensive — loop exits via return/throw above; unreachable.
        throw PlaybackError.streamFetch(message: "exhausted retries")
    }
}
