export type SlotEvent = "submit" | "sent" | "error" | "empty";

/** Mutable hand-off between the message form (React) and the renderer (rAF loop). */
export class SlotBridge {
  text = "";
  caret = 0;
  scroll = 0;
  focused = false;
  version = 0;
  readonly queue: SlotEvent[] = [];

  setText(text: string, caret: number, scroll: number) {
    if (text === this.text && caret === this.caret && scroll === this.scroll) return;
    this.text = text;
    this.caret = caret;
    this.scroll = scroll;
    this.version++;
  }

  setFocus(focused: boolean) {
    this.focused = focused;
    this.version++;
  }

  emit(event: SlotEvent) {
    this.queue.push(event);
  }
}
