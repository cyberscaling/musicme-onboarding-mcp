// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SASCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v12),
    ],
    products: [
        .library(name: "SASCore", targets: ["SASCore"])
    ],
    dependencies: [
        // Reuse AES-CTR + future offline primitives from the already-merged
        // modules/offline-core package (PR #5 on main).
        .package(path: "../../../../modules/offline-core"),
    ],
    targets: [
        .target(
            name: "SASCore",
            dependencies: [
                .product(name: "OfflineCore", package: "offline-core"),
            ]
        ),
        .testTarget(
            name: "SASCoreTests",
            dependencies: ["SASCore"]
        ),
    ]
)
