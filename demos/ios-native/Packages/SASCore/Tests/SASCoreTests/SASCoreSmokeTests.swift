import XCTest
@testable import SASCore

final class SASCoreSmokeTests: XCTestCase {
    func test_versionIsNonEmpty() {
        XCTAssertFalse(SASCore.version.isEmpty)
    }
}
