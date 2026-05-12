// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OfflineCore",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "OfflineCore", targets: ["OfflineCore"]),
    ],
    targets: [
        .target(
            name: "OfflineCore",
            linkerSettings: [
                .linkedLibrary("sqlite3"),
            ]
        ),
        .testTarget(
            name: "OfflineCoreTests",
            dependencies: ["OfflineCore"]
        ),
    ]
)
