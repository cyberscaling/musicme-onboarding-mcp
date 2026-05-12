import SwiftUI
import SASCore
import SASUI

struct MainTabsView: View {
    let store: PlayerStore
    let onLogout: () -> Void

    @State private var selection: DemoTab = .home
    @State private var showQueue = false
    @State private var showPlayer = false

    var body: some View {
        ZStack(alignment: .bottom) {
            NavigationStack {
                Group {
                    switch selection {
                    case .home: HomeView(store: store)
                    case .search: SearchView(store: store)
                    case .library: LibraryView(store: store)
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: onLogout) {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
                .navigationDestination(isPresented: $showQueue) {
                    QueueView(store: store)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let track = store.track {
                        MiniBar(
                            title: track.title,
                            artist: track.artist,
                            coverURL: track.coverURL,
                            playing: store.playing,
                            onTogglePlay: { store.togglePlayback() },
                            onPrev: { store.prev() },
                            onNext: { store.next() },
                            onOpenPlayer: { showPlayer = true },
                            onOpenQueue: { showQueue = true }
                        )
                    }
                    BottomTabBar(selection: $selection)
                }
            }
        }
        .fullScreenCover(isPresented: $showPlayer) {
            PlayerView(store: store, dismiss: { showPlayer = false })
        }
    }
}
