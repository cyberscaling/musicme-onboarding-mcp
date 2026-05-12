// Tiny pushState router (mirrors admin-pages/src/router.ts).
export type Route = {
  path: RegExp
  render: (root: HTMLElement, match: RegExpMatchArray) => void
}

let currentRoot: HTMLElement | null = null
let routes: Route[] = []

export function startRouter(root: HTMLElement, defs: Route[]): void {
  currentRoot = root
  routes = defs
  window.addEventListener('popstate', () => render())
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return
    const a = e.target.closest('a[data-link]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    navigate(a.getAttribute('href') ?? '/')
  })
  render()
}

export function navigate(path: string): void {
  if (location.pathname + location.search === path) return
  history.pushState({}, '', path)
  render()
}

export function render(): void {
  if (!currentRoot) return
  const path = location.pathname
  for (const r of routes) {
    const m = path.match(r.path)
    if (m) {
      currentRoot.innerHTML = ''
      r.render(currentRoot, m)
      return
    }
  }
  currentRoot.innerHTML = '<div class="empty">404 — route inconnue</div>'
}
