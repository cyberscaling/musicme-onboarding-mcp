import Foundation

enum AppConfig {
    /// Read at launch from Info.plist `WEBAPP_URL` (set by project.yml from env var) or env directly.
    static var webappBaseURL: URL {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "WEBAPP_URL") as? String)
            ?? ProcessInfo.processInfo.environment["WEBAPP_URL"]
            ?? "https://your-webapp.workers.dev"
        return URL(string: raw) ?? URL(string: "https://your-webapp.workers.dev")!
    }
}
