import XCTest
@testable import OfflineCore

final class LicenseClaimsTests: XCTestCase {
    func testDecodesValidJWT() throws {
        let jwt = sampleJWT()
        let claims = try LicenseClaims.decode(jwt: jwt)
        XCTAssertEqual(claims.trackId, "100:0:5")
        XCTAssertEqual(claims.mid, 12345)
        XCTAssertEqual(claims.deviceId, "d1")
        XCTAssertEqual(claims.userId, "user-1")
        XCTAssertEqual(claims.v, "offline-v1")
        XCTAssertEqual(claims.key.count, 32)
        XCTAssertEqual(claims.iv.count, 16)
        XCTAssertEqual(claims.exp - claims.iat, 2_592_000)
    }

    func testRejectsMalformed() {
        XCTAssertThrowsError(try LicenseClaims.decode(jwt: "not.a.jwt")) { error in
            XCTAssertEqual(error as? OfflineError, .malformedLicense)
        }
        XCTAssertThrowsError(try LicenseClaims.decode(jwt: "abc"))
    }

    func testRejectsUnsupportedVersion() {
        let bodyJSON = "{\"trackId\":\"x\",\"mid\":1,\"deviceId\":\"d\",\"userId\":\"u\",\"key\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\",\"iv\":\"AAAAAAAAAAAAAAAAAAAAAA==\",\"exp\":2,\"iat\":1,\"v\":\"future-v\"}"
        let header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        let body = base64URLEncode(bodyJSON.data(using: .utf8)!)
        let jwt = "\(header).\(body).XXXX"
        XCTAssertThrowsError(try LicenseClaims.decode(jwt: jwt)) { error in
            XCTAssertEqual(error as? OfflineError, .unsupportedLicenseVersion)
        }
    }

    // ── Test helpers ───────────────────────────────────────────────────────

    private func sampleJWT() -> String {
        let iat = 1_777_000_000
        let exp = iat + 2_592_000
        let body: [String: Any] = [
            "trackId": "100:0:5",
            "mid": 12345,
            "deviceId": "d1",
            "userId": "user-1",
            "key": Data(repeating: 0x01, count: 32).base64EncodedString(),
            "iv":  Data(repeating: 0x02, count: 16).base64EncodedString(),
            "exp": exp,
            "iat": iat,
            "v": "offline-v1",
        ]
        let header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        let bodyData = try! JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        return "\(header).\(base64URLEncode(bodyData)).fake-sig"
    }

    private func base64URLEncode(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
