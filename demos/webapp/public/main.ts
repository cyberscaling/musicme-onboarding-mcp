import { ApiError, api, type Me } from './api'
import { getCastStore } from './cast-sender'
import { mountMiniBar } from './components/mini-bar'
import { mountQueuePanel } from './components/queue-panel'
import { mountTopNav, setTopNavUser } from './components/top-nav'
import { albumPage } from './pages/album'
import { artistPage } from './pages/artist'
import { explainPage } from './pages/explain'
import { homePage } from './pages/home'
import { loginPage } from './pages/login'
import { searchPage } from './pages/search'
import { stylePage } from './pages/style'
import { playlistStore } from './playlist-store'
import { type Route, navigate, startRouter } from './router'

async function getMe(): Promise<Me | null> {
  try {
    return await api.me()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

function withAuth(render: (root: HTMLElement, me: Me, match: RegExpMatchArray) => void) {
  return (root: HTMLElement, match: RegExpMatchArray): void => {
    void (async () => {
      const me = await getMe()
      if (!me) {
        setTopNavUser(null)
        navigate('/login')
        return
      }
      setTopNavUser(me.username)
      await ensurePlaylistStoreReady()
      render(root, me, match)
    })()
  }
}

let playlistStoreReady: Promise<void> | null = null
async function ensurePlaylistStoreReady(): Promise<void> {
  if (playlistStoreReady) return playlistStoreReady
  playlistStoreReady = (async () => {
    const cfg = await api.config()
    const audio = document.getElementById('player') as HTMLAudioElement
    playlistStore.init(audio, cfg.streamWorkerUrl, async () => (await api.mintJwt()).token)
    mountMiniBar(document.getElementById('player-bar') as HTMLElement)
    mountQueuePanel(document.getElementById('queue-panel') as HTMLElement)
    if (cfg.castAppId) {
      void getCastStore().init(cfg.castAppId, cfg.jwtTtlSeconds)
    }
  })()
  return playlistStoreReady
}

mountTopNav(document.getElementById('top-nav') as HTMLElement)
setTopNavUser(null)

const root = document.getElementById('root') as HTMLElement

const routes: Route[] = [
  { path: /^\/login\/?$/, render: (r) => loginPage(r) },
  { path: /^\/explain\/?$/, render: withAuth((r, me) => explainPage(r, me)) },
  {
    path: /^\/album\/(\d{8,18})\/?$/,
    render: withAuth((r, me, m) => albumPage(r, me, m[1]!)),
  },
  {
    path: /^\/artist\/(\d+)\/?$/,
    render: withAuth((r, _me, m) => artistPage(r, Number(m[1]!))),
  },
  {
    path: /^\/style\/(\d+)\/?$/,
    render: withAuth((r, _me, m) => stylePage(r, Number(m[1]!))),
  },
  { path: /^\/search\/?$/, render: withAuth((r, me) => searchPage(r, me)) },
  { path: /^\/?$/, render: withAuth((r, _me) => homePage(r)) },
]

startRouter(root, routes)
