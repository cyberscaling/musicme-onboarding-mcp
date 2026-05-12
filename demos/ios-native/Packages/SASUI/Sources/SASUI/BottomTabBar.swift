import SwiftUI

public enum DemoTab: String, CaseIterable, Identifiable {
    case home, search, library
    public var id: String { rawValue }
    public var systemImage: String {
        switch self {
        case .home: return "house"
        case .search: return "magnifyingglass"
        case .library: return "music.note.list"
        }
    }
    public var title: String {
        switch self {
        case .home: return "Accueil"
        case .search: return "Recherche"
        case .library: return "Library"
        }
    }
}

public struct BottomTabBar: View {
    @Binding var selection: DemoTab

    public init(selection: Binding<DemoTab>) {
        _selection = selection
    }

    public var body: some View {
        HStack {
            ForEach(DemoTab.allCases) { tab in
                Button {
                    selection = tab
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: tab.systemImage).font(.title3)
                        Text(tab.title).font(.caption2)
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(selection == tab ? Color.accentColor : .secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .background(.bar)
    }
}
