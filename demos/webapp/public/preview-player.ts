import {
  type PrefetchedSession,
  type PreviewSeconds,
  SecureAudioPlayer,
  type SecureAudioPlayerOptions,
  type TrackRef,
} from '@cyberscaling/secure-audio-stream-client'

/** Bridges the demo playlist's player contract to SDK preview playback. */
export class PreviewAudioPlayer extends SecureAudioPlayer {
  constructor(
    options: SecureAudioPlayerOptions,
    private readonly targetRef: TrackRef,
    private readonly onPreviewReady: (seconds: PreviewSeconds) => void,
  ) {
    super(options)
  }

  override load(ref: TrackRef): Promise<void> {
    return this.loadSdkPreview(ref)
  }

  override loadPrefetched(_unused: PrefetchedSession): Promise<void> {
    return this.loadSdkPreview(this.targetRef)
  }

  private async loadSdkPreview(ref: TrackRef): Promise<void> {
    const result = await super.loadPreview(ref)
    this.onPreviewReady(result.previewSeconds)
  }
}
