import XCTest
@testable import OfflineCore

final class OfflineCatalogTests: XCTestCase {
    var dbURL: URL!

    override func setUp() {
        super.setUp()
        dbURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("offline-test-\(UUID().uuidString).sqlite")
    }
    override func tearDown() {
        try? FileManager.default.removeItem(at: dbURL)
        super.tearDown()
    }

    func testSchemaCreatedOnOpen() throws {
        _ = try OfflineCatalog(databaseURL: dbURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: dbURL.path))
    }

    func testInsertAndGet() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        let row = sampleRow(trackId: "1:0:1")
        try catalog.insert(row)
        let got = try catalog.get(trackId: "1:0:1")
        XCTAssertEqual(got, row)
    }

    func testGetMissingReturnsNil() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        XCTAssertNil(try catalog.get(trackId: "absent"))
    }

    func testList() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        try catalog.insert(sampleRow(trackId: "1:0:1"))
        try catalog.insert(sampleRow(trackId: "1:0:2"))
        let all = try catalog.list()
        XCTAssertEqual(all.count, 2)
        XCTAssertEqual(Set(all.map { $0.trackId }), ["1:0:1", "1:0:2"])
    }

    func testRemove() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        try catalog.insert(sampleRow(trackId: "x"))
        try catalog.remove(trackId: "x")
        XCTAssertNil(try catalog.get(trackId: "x"))
    }

    func testWipeAll() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        try catalog.insert(sampleRow(trackId: "a"))
        try catalog.insert(sampleRow(trackId: "b"))
        try catalog.wipeAll()
        XCTAssertEqual(try catalog.list().count, 0)
    }

    func testMarkCorrupted() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        try catalog.insert(sampleRow(trackId: "x"))
        try catalog.markCorrupted(trackId: "x")
        let row = try catalog.get(trackId: "x")
        XCTAssertTrue(row?.corrupted ?? false)
    }

    func testUpdateLicenseExp() throws {
        let catalog = try OfflineCatalog(databaseURL: dbURL)
        try catalog.insert(sampleRow(trackId: "x"))
        try catalog.updateLicenseExp(trackId: "x", exp: 9_999_999_999, iat: 9_000_000_000)
        let row = try XCTUnwrap(catalog.get(trackId: "x"))
        XCTAssertEqual(row.licenseExp, 9_999_999_999)
        XCTAssertEqual(row.licenseIat, 9_000_000_000)
    }

    private func sampleRow(trackId: String) -> OfflineTrackRow {
        return OfflineTrackRow(
            trackId: trackId,
            deviceId: "d1",
            blobPath: "/tmp/blob-\(trackId).bin",
            sizeBytes: 1024,
            wrappedKey: Data(repeating: 0x11, count: 48),
            wrapNonce: Data(repeating: 0x22, count: 12),
            trackIv: Data(repeating: 0x33, count: 16),
            licenseExp: 2_000_000_000,
            licenseIat: 1_900_000_000,
            downloadedAt: 1_900_000_500,
            metaJSON: "{\"title\":\"t\"}",
            corrupted: false
        )
    }
}
