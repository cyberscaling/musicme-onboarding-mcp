/**
 * Patch happy-dom's DragEvent (which is aliased to Event) to support
 * the `dataTransfer` property from the EventInit dict. This makes drag-and-drop
 * tests work correctly in the happy-dom test environment.
 */

const OriginalDragEvent = globalThis.DragEvent

class PatchedDragEvent extends OriginalDragEvent {
  readonly dataTransfer: DataTransfer | null

  constructor(type: string, init?: DragEventInit) {
    super(type, init)
    this.dataTransfer = init?.dataTransfer ?? null
  }
}

globalThis.DragEvent = PatchedDragEvent as typeof DragEvent
