/**
 * CAF receiver shell. Fetches webapp config (same-origin, public route) for
 * the stream worker URL, then wires the custom message channel into
 * ReceiverController. With `?dev=1` the CAF framework is skipped and the
 * controller is exposed as window.__sasCast for manual testing in a normal
 * browser tab.
 */
import { coverUrl } from '../covers'
import { CAST_NAMESPACE, parseSenderMessage, type ReceiverMessage } from './protocol'
import { ReceiverController } from './receiver-controller'

async function boot(): Promise<void> {
  const cfg = (await (await fetch('/api/config')).json()) as { streamWorkerUrl: string }
  const audio = document.getElementById('player') as HTMLAudioElement
  const coverEl = document.querySelector('img.cover') as HTMLImageElement
  const titleEl = document.querySelector('.title') as HTMLElement
  const artistEl = document.querySelector('.artist') as HTMLElement

  const dev = new URLSearchParams(location.search).has('dev')
  const ctx = dev ? null : cast.framework.CastReceiverContext.getInstance()

  const send = (msg: ReceiverMessage): void => {
    if (ctx) ctx.sendCustomMessage(CAST_NAMESPACE, undefined, msg)
    else console.log('[sas-cast] →', msg)
  }

  const controller = new ReceiverController({
    workerUrl: cfg.streamWorkerUrl,
    audioElement: audio,
    send,
    onTrackChange: (meta) => {
      titleEl.textContent = meta?.title ?? 'En attente du sender…'
      artistEl.textContent = meta?.artist ?? ''
      if (meta?.coverCb) {
        coverEl.src = coverUrl(meta.coverCb, 500)
        coverEl.hidden = false
      } else {
        coverEl.hidden = true
      }
    },
  })

  if (ctx) {
    ctx.addCustomMessageListener(CAST_NAMESPACE, (event) => {
      const msg = parseSenderMessage(event.data)
      if (msg) void controller.handleMessage(msg)
    })
    ctx.addEventListener(cast.framework.system.EventType.SENDER_CONNECTED, () => {
      controller.statusNow()
    })
    // We play through our own <audio>+MSE, not CAF's PlayerManager:
    //  - skipPlayersLoad: don't load Shaka/MPL — they fight our media element.
    //  - disableIdleTimeout: CAF never sees "media playing", so don't let it
    //    treat the receiver as idle and tear it down.
    //  - maxInactivity: keep the sender connection heartbeat generous.
    ctx.start({ disableIdleTimeout: true, skipPlayersLoad: true, maxInactivity: 3600 })
  } else {
    ;(window as unknown as { __sasCast: ReceiverController }).__sasCast = controller
  }
}

void boot()
