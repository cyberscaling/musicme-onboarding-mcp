// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SASUI",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "SASUI", targets: ["SASUI"])
    ],
    targets: [
        .target(name: "SASUI")
    ]
)
