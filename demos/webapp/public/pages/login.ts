import { ApiError, api } from '../api'
import { el } from '../components/layout'
import { navigate } from '../router'

export function loginPage(root: HTMLElement): void {
  const wrap = el('div', 'login')
  wrap.innerHTML = `
    <div class="login-card">
      <h1>Sa</h1>
      <div class="subtitle">Stream Demo · login</div>
      <form id="form" class="col" autocomplete="off">
        <label class="field">
          <span>username</span>
          <input id="u" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required />
        </label>
        <label class="field">
          <span>password</span>
          <input id="p" type="password" autocomplete="current-password" required />
        </label>
        <button class="primary" type="submit">login</button>
      </form>
      <div id="status" class="status"></div>
    </div>
  `
  root.appendChild(wrap)
  const form = wrap.querySelector<HTMLFormElement>('#form')!
  const statusEl = wrap.querySelector<HTMLDivElement>('#status')!
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    statusEl.textContent = 'authenticating…'
    statusEl.className = 'status'
    const u = wrap.querySelector<HTMLInputElement>('#u')!.value.trim()
    const p = wrap.querySelector<HTMLInputElement>('#p')!.value
    try {
      await api.login(u, p)
      statusEl.textContent = 'ok — redirect'
      statusEl.className = 'status ok'
      navigate('/')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'error'
      statusEl.textContent = `login failed: ${code}`
      statusEl.className = 'status err'
    }
  })
}
