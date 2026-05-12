import SwiftUI
import AVFoundation
import SASCore

private struct AppContainerKey: EnvironmentKey {
    /// Real default — SwiftUI may read the env during graph propagation before
    /// the explicit `.environment(...)` binding takes effect. `AppContainer.init()`
    /// is non-MainActor and cheap (no network), so a default instance is safe.
    /// The root app overrides this with its own instance immediately.
    static let defaultValue: AppContainer = AppContainer()
}

extension EnvironmentValues {
    var appContainer: AppContainer {
        get { self[AppContainerKey.self] }
        set { self[AppContainerKey.self] = newValue }
    }
}

@main
struct SASDemoiOSApp: App {
    @State private var container = AppContainer()

    init() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
            try AVAudioSession.sharedInstance().setActive(true, options: [])
        } catch {
            print("AVAudioSession setup failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.appContainer, container)
        }
    }
}
