/**
 * Persistent top navigation bar. Mounted once at boot.
 * Visible only when authenticated (toggle via setVisible after /me probe).
 */
import { api } from '../api'
import { getCastStore } from '../cast-sender'
import { playlistStore } from '../playlist-store'
import { navigate } from '../router'

let backStack: string[] = []
let mounted = false

export function mountTopNav(root: HTMLElement): void {
  if (mounted) return
  mounted = true
  root.innerHTML = `
    <nav class="top-nav">
      <button data-action="back" aria-label="back" title="back">‹</button>
      <a data-action="home" href="/" class="brand">MusicMe</a>
      <a data-action="search" href="/search">search</a>
      <span class="spacer"></span>
      <div class="playback-mode" role="group" aria-label="Mode de lecture du prochain morceau">
        <button type="button" data-mode="full" aria-pressed="true">
          <span class="mode-label-wide">Flux complet</span><span class="mode-label-short">Complet</span>
        </button>
        <button type="button" data-mode="preview" aria-pressed="false">
          <span>Extrait</span>
        </button>
      </div>
      <span class="who" data-slot="who"></span>
      <button data-action="logout" aria-label="logout">logout</button>
    </nav>
  `
  root.querySelector<HTMLButtonElement>('[data-action="back"]')!.addEventListener('click', () => {
    if (backStack.length >= 2) {
      backStack.pop()
      const prev = backStack[backStack.length - 1]!
      navigate(prev)
    } else {
      navigate('/')
    }
  })
  root.querySelector<HTMLAnchorElement>('[data-action="home"]')!.addEventListener('click', (e) => {
    e.preventDefault()
    navigate('/')
  })
  root
    .querySelector<HTMLAnchorElement>('[data-action="search"]')!
    .addEventListener('click', (e) => {
      e.preventDefault()
      navigate('/search')
    })
  root
    .querySelector<HTMLButtonElement>('[data-action="logout"]')!
    .addEventListener('click', async () => {
      try {
        await api.logout()
      } catch {
        // ignore — clear happens in finally
      }
      backStack = []
      navigate('/login')
    })

  const cast = getCastStore()
  const fullModeButton = root.querySelector<HTMLButtonElement>('[data-mode="full"]')!
  const previewModeButton = root.querySelector<HTMLButtonElement>('[data-mode="preview"]')!
  fullModeButton.addEventListener('click', () => playlistStore.setPreviewEnabled(false))
  previewModeButton.addEventListener('click', () => playlistStore.setPreviewEnabled(true))

  const renderPlaybackMode = (): void => {
    const previewEnabled = playlistStore.previewEnabled
    const castConnected = cast.state === 'connected'
    fullModeButton.setAttribute('aria-pressed', String(!previewEnabled))
    previewModeButton.setAttribute('aria-pressed', String(previewEnabled))
    fullModeButton.disabled = castConnected
    previewModeButton.disabled = castConnected
    const castTitle = castConnected
      ? 'Déconnectez Cast pour modifier le mode de lecture'
      : 'Mode appliqué au prochain morceau'
    fullModeButton.title = castTitle
    previewModeButton.title = castTitle
  }
  playlistStore.onChange(renderPlaybackMode)
  cast.onChange(renderPlaybackMode)
  renderPlaybackMode()

  // Track navigation history for back button
  const updateStack = (): void => {
    const path = location.pathname
    if (backStack[backStack.length - 1] !== path) backStack.push(path)
    if (backStack.length > 50) backStack.shift()
  }
  updateStack()
  window.addEventListener('popstate', updateStack)
  // Patch pushState to record nav
  const origPush = history.pushState.bind(history)
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    origPush(...args)
    updateStack()
  }
}

export function setTopNavUser(username: string | null): void {
  const who = document.querySelector<HTMLElement>('#top-nav [data-slot="who"]')
  if (who) who.textContent = username ?? ''
  const nav = document.querySelector<HTMLElement>('#top-nav .top-nav')
  if (nav) nav.style.display = username ? 'flex' : 'none'
}
