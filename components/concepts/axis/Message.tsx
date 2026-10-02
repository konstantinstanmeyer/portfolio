"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from "react";
import { sendMessage } from "@/app/actions";
import { initialMessageState, MAX_MESSAGE_LENGTH } from "@/lib/message";
import type { Engine } from "./engine";
import styles from "./axis.module.css";

type Glyph = { id: number; ch: string };
type Phase = "idle" | "sent" | "error";

const TYPE_WGHT = 340;
let uid = 0;

/** Keeps ids of untouched characters stable, so only new ones animate in. */
function reconcile(prev: Glyph[], text: string): Glyph[] {
  const next = Array.from(text);
  let p = 0;
  while (p < prev.length && p < next.length && prev[p].ch === next[p]) p++;
  let s = 0;
  while (s < prev.length - p && s < next.length - p && prev[prev.length - 1 - s].ch === next[next.length - 1 - s]) s++;
  const fresh = next.slice(p, next.length - s).map((ch) => ({ id: ++uid, ch }));
  return prev.slice(0, p).concat(fresh, prev.slice(prev.length - s));
}

export function Message({ engine }: { engine: RefObject<Engine | null> }) {
  const [state, formAction, pending] = useActionState(sendMessage, initialMessageState);
  const [value, setValue] = useState("");
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seen, setSeen] = useState(initialMessageState.at);

  if (state.at !== seen) {
    setSeen(state.at);
    setPhase(state.status === "sent" ? "sent" : "error");
  }

  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const lengthRef = useRef(0);

  const open = focused || value.length > 0 || pending || phase === "sent";

  useEffect(() => {
    engine.current?.setOpen(open);
  }, [engine, open]);

  // Condense the typed line through wdth before it ever needs to scroll.
  const fit = useCallback(() => {
    const form = formRef.current;
    const m = measureRef.current;
    if (!form || !m) return;
    const avail = form.clientWidth - (sendRef.current?.offsetWidth ?? 0) - 8;
    m.textContent = value;
    m.style.fontVariationSettings = `"wdth" 100, "wght" ${TYPE_WGHT}, "opsz" var(--mo, 32)`;
    const w100 = m.offsetWidth;
    m.style.fontVariationSettings = `"wdth" 25, "wght" ${TYPE_WGHT}, "opsz" var(--mo, 32)`;
    const w25 = m.offsetWidth;
    let wd = 100;
    let scale = 1;
    let shift = 0;
    if (w100 > avail) {
      if (w25 <= avail) wd = 25 + (75 * (avail - w25)) / Math.max(1, w100 - w25);
      else {
        wd = 25;
        scale = Math.max(0.42, avail / w25);
        shift = Math.max(0, w25 * scale - avail);
      }
    }
    form.style.setProperty("--mw", wd.toFixed(2));
    form.style.setProperty("--ms", scale.toFixed(4));
    form.style.setProperty("--mx", `${(-shift).toFixed(1)}px`);
  }, [value]);

  useLayoutEffect(fit, [fit]);

  // Each keystroke presses into the letters above and below the caret.
  useLayoutEffect(() => {
    const grew = value.length - lengthRef.current;
    lengthRef.current = value.length;
    const x = caretRef.current?.getBoundingClientRect().left;
    if (!grew || x === undefined || !value) return;
    engine.current?.poke(x, grew > 0 ? 0.55 : -0.35);
  }, [engine, value]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // the band's height animates every frame; only a new measure needs a refit
    let width = form.clientWidth;
    const ro = new ResizeObserver(() => {
      if (form.clientWidth === width) return;
      width = form.clientWidth;
      fit();
    });
    ro.observe(form);
    return () => ro.disconnect();
  }, [fit]);

  // Anything typed on the page lands in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.tagName !== "MAIN") return;
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const e = engine.current;
    if (phase === "sent") {
      const a = setTimeout(() => e?.pluck(1), 300);
      const b = setTimeout(() => {
        setValue("");
        setGlyphs([]);
        setCaret(0);
        setPhase("idle");
        inputRef.current?.blur();
      }, 1000);
      return () => {
        clearTimeout(a);
        clearTimeout(b);
      };
    }
    e?.pluck(-1, 0.45);
    const b = setTimeout(() => setPhase("idle"), 1600);
    return () => clearTimeout(b);
  }, [engine, phase, seen]);

  const onChange = (next: string, selection: number | null) => {
    setValue(next);
    setGlyphs((g) => reconcile(g, next));
    setCaret(Array.from(next.slice(0, selection ?? next.length)).length);
  };

  const onSelect = () => {
    const input = inputRef.current;
    if (!input) return;
    setCaret(Array.from(input.value.slice(0, input.selectionStart ?? input.value.length)).length);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || phase === "sent" || !value.trim()) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  const busy = pending || phase === "sent";
  const showCaret = !busy && (focused || value.length === 0);
  const line: (Glyph | null)[] = glyphs.slice(0, caret);
  line.push(null);
  line.push(...glyphs.slice(caret));

  return (
    <form
      ref={formRef}
      className={styles.band}
      onSubmit={submit}
      data-focus={focused || undefined}
      data-pending={pending || undefined}
      data-phase={phase}
      data-filled={value.length > 0 || undefined}
    >
      <div className={styles.rule} aria-hidden="true">
        <i key={seen} className={styles.spark} />
      </div>
      <div className={styles.line} aria-hidden="true">
        <div className={styles.mirror}>
          {line.map((g, i) =>
            g ? (
              <span key={g.id} className={styles.ch} style={{ "--i": i } as CSSProperties}>
                {g.ch}
              </span>
            ) : (
              <span key="caret" ref={caretRef} className={styles.caret} data-on={showCaret || undefined} />
            ),
          )}
        </div>
      </div>
      <span ref={measureRef} className={styles.measure} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.input}
        name="message"
        aria-label="Message to Konstantin"
        maxLength={MAX_MESSAGE_LENGTH}
        value={value}
        readOnly={busy}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onSelect={onSelect}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <button ref={sendRef} type="submit" className={styles.send} aria-label="Send" disabled={!value.trim() || busy}>
        <svg viewBox="0 0 40 24" aria-hidden="true" className={styles.arrow}>
          <path d="M1 12h37M27 1.5 38 12 27 22.5" />
        </svg>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.cross}>
          <path d="M3 3l18 18M21 3 3 21" />
        </svg>
      </button>
      <p className={styles.sr} aria-live="polite">
        {phase === "sent" ? "Message sent." : phase === "error" ? "Message not sent. Please try again." : ""}
      </p>
    </form>
  );
}
