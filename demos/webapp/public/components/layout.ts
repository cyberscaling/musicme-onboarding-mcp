import { api, type Me, type NavActive } from '../api'
import { navigate } from '../router'

export function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  return e
}

export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function appLayout(content: HTMLElement, opts: { me: Me; active: NavActive }): HTMLElement {
  const root = el('div', 'app')
  root.appendChild(workspaceBar(opts))
  const main = el('main')
  main.appendChild(content)
  root.appendChild(main)
  return root
}

function workspaceBar(opts: { me: Me; active: NavActive }): HTMLElement {
  const bar = el('div', 'workspace-bar')
  const links = [
    { id: 'search', label: 'recherche', href: '/' },
    { id: 'explain', label: 'comment ça marche', href: '/explain' },
  ] as const
  bar.innerHTML = `
    <span class="brand">Sa</span>
    <span class="name">Stream Demo</span>
    <span class="nav">
      ${links
        .map(
          (l) =>
            `<a href="${l.href}" data-link class="${l.id === opts.active ? 'active' : ''}">${l.label}</a>`,
        )
        .join('')}
    </span>
    <span class="spacer"></span>
    <span class="me">${escape(opts.me.username)}</span>
    <button class="ghost" data-action="logout" type="button">logout</button>
  `
  bar.querySelector('[data-action=logout]')?.addEventListener('click', async () => {
    try {
      await api.logout()
    } finally {
      navigate('/login')
    }
  })
  return bar
}
