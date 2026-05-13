import ExpoModulesCore
import Foundation
import Security

public class OfflineExpoModule: Module {
    private var service: OfflineService?

    public func definition() -> ModuleDefinition {
        Name("OfflineExpoModule")

        Events("offline:download:progress", "offline:download:complete",
               "offline:download:error", "offline:license:expired",
               "player:remote:next", "player:remote:prev")

        OnCreate {
            let libURL = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            let root = libURL.appendingPathComponent("offline")
            self.service = try? OfflineService(rootDirectory: root)
            OfflineSingleton.shared.service = self.service
        }

        OnStartObserving("player:remote:next") { [weak self] in
            NotificationCenter.default.addObserver(
                forName: .nativePlayerRemoteNext, object: nil, queue: .main) { [weak self] _ in
                self?.sendEvent("player:remote:next", [:])
            }
        }
        OnStopObserving("player:remote:next") {
            NotificationCenter.default.removeObserver(self, name: .nativePlayerRemoteNext, object: nil)
        }
        OnStartObserving("player:remote:prev") { [weak self] in
            NotificationCenter.default.addObserver(
                forName: .nativePlayerRemotePrev, object: nil, queue: .main) { [weak self] _ in
                self?.sendEvent("player:remote:prev", [:])
            }
        }
        OnStopObserving("player:remote:prev") {
            NotificationCenter.default.removeObserver(self, name: .nativePlayerRemotePrev, object: nil)
        }

        AsyncFunction("ingestDownload") { (tmpPath: String, license: String, sizeBytes: Double, metaJson: String?) -> String in
            guard let svc = self.service else { throw OfflineExpoError.notReady }
            let tmpURL = URL(fileURLWithPath: tmpPath)
            try svc.ingestDownload(
                tmpFileURL: tmpURL,
                license: license,
                sizeBytes: Int64(sizeBytes),
                metaJSON: metaJson
            )
            let trackId = (try? LicenseClaims.decode(jwt: license))?.trackId ?? ""
            self.sendEvent("offline:download:complete", ["trackId": trackId])
            return trackId
        }

        AsyncFunction("updateLicense") { (trackId: String, license: String) -> Void in
            guard let svc = self.service else { throw OfflineExpoError.notReady }
            let claims = try LicenseClaims.decode(jwt: license)
            guard claims.trackId == trackId else { throw OfflineExpoError.trackMismatch }
            try svc.catalog.updateLicenseExp(trackId: trackId, exp: claims.exp, iat: claims.iat)
        }

        AsyncFunction("listTracks") { () -> [[String: Any?]] in
            guard let svc = self.service else { throw OfflineExpoError.notReady }
            let rows = try svc.listTracks()
            return rows.map { rowToDict($0) }
        }

        AsyncFunction("hasTrack") { (trackId: String) -> Bool in
            guard let svc = self.service else { throw OfflineExpoError.notReady }
            return try svc.hasTrack(trackId: trackId)
        }

        AsyncFunction("removeTrack") { (trackId: String) -> Void in
            guard let svc = self.service else { throw OfflineExpoError.notReady }
            try svc.removeTrack(trackId: trackId)
        }

        AsyncFunction("wipeAll") { () -> Void in
            guard let svc = self.service else { throw OfflineExpoError.notReady }
            try svc.wipeAll()
        }

        AsyncFunction("getDeviceId") { () -> String in
            DeviceIdProvider.current()
        }

        AsyncFunction("configurePlayer") { (workerUrl: String, token: String) -> Void in
            PlayerConfig.shared.workerUrl = URL(string: workerUrl)
            PlayerConfig.shared.currentToken = token
            PlayerConfig.shared.tokenProvider = { @Sendable in
                PlayerConfig.shared.currentToken ?? ""
            }
        }

        AsyncFunction("setStreamToken") { (token: String) -> Void in
            PlayerConfig.shared.currentToken = token
        }

        AsyncFunction("prefetch") { (ref: [String: Int]) -> Void in
            guard let cb = ref["cb"], let disc = ref["disc"], let track = ref["track"],
                  let service = OfflineSingleton.shared.service,
                  let workerUrl = PlayerConfig.shared.workerUrl,
                  let tokenProvider = PlayerConfig.shared.tokenProvider
            else { return }
            let trackId = "\(cb):\(disc):\(track)"
            let trackRef = StreamSession.TrackRef(cb: cb, disc: disc, track: track)
            do {
                let source = try service.openSource(
                    ref: trackRef, workerUrl: workerUrl, tokenProvider: tokenProvider)
                if let ss = source as? StreamSource { try await ss.prepare() }
                _ = try? await source.read(range: 0..<min(256 * 1024, source.fileSize))
                PrefetchCache.shared.put(trackId, source)
            } catch {
                // best-effort
            }
        }

        View(NativePlayer.self) {
            Prop("trackRef") { (view: NativePlayer, ref: [String: Int]) in
                guard let cb = ref["cb"], let disc = ref["disc"], let track = ref["track"] else { return }
                view.load(cb: cb, disc: disc, track: track)
            }
            Prop("title")    { (view: NativePlayer, t: String?) in view.trackTitle  = t }
            Prop("artist")   { (view: NativePlayer, a: String?) in view.trackArtist = a }
            Prop("coverUrl") { (view: NativePlayer, c: String?) in view.trackCoverUrl = c }
            Prop("autoPlay") { (view: NativePlayer, ap: Bool) in view.autoPlay = ap }
            Prop("playing") { (view: NativePlayer, p: Bool) in view.setPlaying(p) }
            Prop("seekToMs") { (view: NativePlayer, t: Double?) in if let t = t { view.seek(toMs: t) } }
            Events("onReady","onError","onPlay","onPause","onTimeUpdate","onEnded","onStalled","onSessionRotated","onMetrics")
        }
    }

    private func rowToDict(_ r: OfflineTrackRow) -> [String: Any?] {
        let meta = r.metaJSON.flatMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        } ?? [:]
        return [
            "trackId": r.trackId,
            // OfflineTrackRow doesn't persist `mid` yet (T7 will patch upstream schema).
            // Surface 0 so the JS facade contract (mid: number) stays stable.
            "mid": Double(0),
            "sizeBytes": Double(r.sizeBytes),
            "downloadedAt": Double(r.downloadedAt),
            "licenseExp": Double(r.licenseExp),
            "meta": meta as Any,
        ]
    }
}

enum OfflineExpoError: Error {
    case notReady
    case trackMismatch
}

final class OfflineSingleton: @unchecked Sendable {
    nonisolated(unsafe) static let shared = OfflineSingleton()
    var service: OfflineService?
    private init() {}
}

struct DeviceIdProvider {
    private static let service = "cc.musicme.offline.deviceId"
    private static let account = "deviceId"

    static func current() -> String {
        if let existing = load() {
            return existing
        }
        let new = UUID().uuidString
        save(new)
        return new
    }

    private static func load() -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data,
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }

    private static func save(_ id: String) {
        let attrs: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecValueData: id.data(using: .utf8) ?? Data(),
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable: kCFBooleanFalse as Any,
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }
}
