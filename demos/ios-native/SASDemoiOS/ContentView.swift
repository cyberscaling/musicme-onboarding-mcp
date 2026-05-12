import SwiftUI
import SASCore

enum RootRoute: Equatable {
    case bootstrapping, login, tabs
}

struct ContentView: View {
    @Environment(\.appContainer) private var container
    @State private var route: RootRoute = .bootstrapping
    @State private var interruption: AVInterruptionObserver?

    var body: some View {
        Group {
            switch route {
            case .bootstrapping:
                ProgressView("Démarrage…")
            case .login:
                LoginView(onSuccess: { Task { await onLoginSuccess() } })
            case .tabs:
                if let store = container.playerStore {
                    MainTabsView(store: store, onLogout: { Task { await onLogout() } })
                } else {
                    ProgressView("Player indisponible…")
                }
            }
        }
        .task { await bootstrap() }
    }

    private func bootstrap() async {
        do {
            let ok = try await container.api.auth.probe()
            if ok {
                await container.bootPlayer()
                if let store = container.playerStore { await store.hydrate() }
                if let store = container.playerStore { interruption = AVInterruptionObserver(store: store) }
                route = .tabs
            } else {
                if let store = container.playerStore { await store.clearLocal() }
                route = .login
            }
        } catch {
            route = .login
        }
    }

    private func onLoginSuccess() async {
        await container.bootPlayer()
        if let store = container.playerStore { await store.hydrate() }
        if let store = container.playerStore { interruption = AVInterruptionObserver(store: store) }
        route = .tabs
    }

    private func onLogout() async {
        if let store = container.playerStore {
            await store.stop()
            await store.clearLocal()
        }
        try? await container.api.auth.logout()
        // Flush cookies for the webapp host explicitly.
        if let cookies = HTTPCookieStorage.shared.cookies(for: AppConfig.webappBaseURL) {
            for c in cookies { HTTPCookieStorage.shared.deleteCookie(c) }
        }
        interruption = nil
        route = .login
    }
}
