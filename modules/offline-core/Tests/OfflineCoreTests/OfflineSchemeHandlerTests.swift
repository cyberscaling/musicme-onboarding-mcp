import XCTest
import WebKit
@testable import OfflineCore

@MainActor
final class OfflineSchemeHandlerTests: XCTestCase {
    var rootURL: URL!
    var dbURL: URL!
    var catalog: OfflineCatalog!
    var blobStore: BlobStore!
    var vault: KeyVault!
    let serviceTag = "OfflineSchemeHandlerTests.\(UUID().uuidString)"

    let deviceId = "device-current"
    let trackId = "100:0:5"

    let plaintext: Data = {
        var d = Data(count: 1024)
        for i in 0..<1024 { d[i] = UInt8(i & 0xFF) }
        return d
    }()

    override func setUp() {
        super.setUp()
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        rootURL = base.appendingPathComponent("blobs")
        dbURL = base.appendingPathComponent("catalog.sqlite")
        try! FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)

        catalog = try! OfflineCatalog(databaseURL: dbURL)
        blobStore = try! BlobStore(rootDirectory: rootURL)
        vault = KeyVault(serviceTag: serviceTag)
    }

    override func tearDown() {
        try? vault.deleteMasterKey()
        try? FileManager.default.removeItem(at: rootURL.deletingLastPathComponent())
        super.tearDown()
    }

    func testFullFileResponseDecryptsCorrectly() throws {
        let key = Data(repeating: 0x11, count: 32)
        let iv = Data(repeating: 0x22, count: 16)
        try seed(key: key, iv: iv, licenseExp: future())

        let handler = OfflineSchemeHandler(catalog: catalog, blobStore: blobStore, keyVault: vault, deviceIdProvider: { self.deviceId })
        let task = MockSchemeTask(url: urlForTrack(trackId), rangeHeader: nil)
        handler.webView(WKWebView(), start: task)

        wait(for: [task.finishExpectation], timeout: 5)
        XCTAssertEqual(task.responseStatus, 200)
        XCTAssertEqual(task.collected, plaintext)
        XCTAssertNil(task.error)
    }

    func testRangeRequestReturns206WithAlignedBytes() throws {
        let key = Data(repeating: 0x33, count: 32)
        let iv = Data(repeating: 0x44, count: 16)
        try seed(key: key, iv: iv, licenseExp: future())

        let handler = OfflineSchemeHandler(catalog: catalog, blobStore: blobStore, keyVault: vault, deviceIdProvider: { self.deviceId })
        // Request bytes 5-25 (unaligned start). Wire = 26 plaintext bytes (0..25); user trims 5 to get 5..25 = 21 bytes.
        let task = MockSchemeTask(url: urlForTrack(trackId), rangeHeader: "bytes=5-25")
        handler.webView(WKWebView(), start: task)
        wait(for: [task.finishExpectation], timeout: 5)
        XCTAssertEqual(task.responseStatus, 206)
        XCTAssertEqual(task.collected.count, 21)
        XCTAssertEqual(task.collected, plaintext.subdata(in: 5..<26))
    }

    func testExpiredLicenseReturns410() throws {
        try seed(key: Data(repeating: 1, count: 32), iv: Data(repeating: 2, count: 16),
                 licenseExp: Int64(Date().timeIntervalSince1970) - 100)

        let handler = OfflineSchemeHandler(catalog: catalog, blobStore: blobStore, keyVault: vault, deviceIdProvider: { self.deviceId })
        let task = MockSchemeTask(url: urlForTrack(trackId), rangeHeader: nil)
        handler.webView(WKWebView(), start: task)
        wait(for: [task.finishExpectation], timeout: 5)
        XCTAssertEqual(task.responseStatus, 410)
    }

    func testDeviceIdMismatchReturns403AndDeletesRow() throws {
        try seed(key: Data(repeating: 1, count: 32), iv: Data(repeating: 2, count: 16),
                 licenseExp: future(), deviceIdOverride: "other-device")

        let handler = OfflineSchemeHandler(catalog: catalog, blobStore: blobStore, keyVault: vault, deviceIdProvider: { self.deviceId })
        let task = MockSchemeTask(url: urlForTrack(trackId), rangeHeader: nil)
        handler.webView(WKWebView(), start: task)
        wait(for: [task.finishExpectation], timeout: 5)
        XCTAssertEqual(task.responseStatus, 403)
        XCTAssertNil(try catalog.get(trackId: trackId))
    }

    func testMissingTrackReturns404() throws {
        let handler = OfflineSchemeHandler(catalog: catalog, blobStore: blobStore, keyVault: vault, deviceIdProvider: { self.deviceId })
        let task = MockSchemeTask(url: URL(string: "offline://absent/audio.m4a")!, rangeHeader: nil)
        handler.webView(WKWebView(), start: task)
        wait(for: [task.finishExpectation], timeout: 5)
        XCTAssertEqual(task.responseStatus, 404)
    }

    // MARK: helpers

    /// `URL(string:)` rejects unescaped colons in the host (interpreted as port separator),
    /// so percent-encode the trackId. `url.host` auto-decodes back to the original value.
    private func urlForTrack(_ id: String) -> URL {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? id
        return URL(string: "offline://\(encoded)/audio.m4a")!
    }

    private func future() -> Int64 { Int64(Date().timeIntervalSince1970) + 30 * 86400 }

    private func seed(key: Data, iv: Data, licenseExp: Int64, deviceIdOverride: String? = nil) throws {
        let ciphertext = try AESCTRDecryptor.decrypt(ciphertext: plaintext, key: key, baseIv: iv, blockIndex: 0)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try ciphertext.write(to: tmp)
        let path = try blobStore.persist(trackId: trackId, from: tmp)

        let wrapped = try vault.wrap(key: key)
        try catalog.insert(OfflineTrackRow(
            trackId: trackId,
            deviceId: deviceIdOverride ?? deviceId,
            blobPath: path,
            sizeBytes: Int64(plaintext.count),
            wrappedKey: wrapped.ciphertext,
            wrapNonce: wrapped.nonce,
            trackIv: iv,
            licenseExp: licenseExp,
            licenseIat: licenseExp - 86400,
            downloadedAt: Int64(Date().timeIntervalSince1970),
            metaJSON: nil,
            corrupted: false
        ))
    }
}

// MARK: - MockSchemeTask

final class MockSchemeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    var responseStatus: Int?
    var responseHeaders: [String: String] = [:]
    var collected = Data()
    var error: Error?
    let finishExpectation = XCTestExpectation(description: "task finished")

    init(url: URL, rangeHeader: String?) {
        var req = URLRequest(url: url)
        if let r = rangeHeader { req.setValue(r, forHTTPHeaderField: "Range") }
        self.request = req
        super.init()
    }

    func didReceive(_ response: URLResponse) {
        if let http = response as? HTTPURLResponse {
            responseStatus = http.statusCode
            responseHeaders = (http.allHeaderFields as? [String: String]) ?? [:]
        }
    }
    func didReceive(_ data: Data) { collected.append(data) }
    func didFinish() { finishExpectation.fulfill() }
    func didFailWithError(_ err: Error) { error = err; finishExpectation.fulfill() }
}
