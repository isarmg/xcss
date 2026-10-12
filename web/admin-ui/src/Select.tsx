import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type SelectHTMLAttributes,
} from "react";
import { validationMessage } from "./i18n.js";

type Props = SelectHTMLAttributes<HTMLSelectElement>;
type Item = { index: number; value: string; label: string; disabled: boolean; hidden: boolean; group: string };
type Snapshot = { items: Item[]; selected: number; disabled: boolean; label: string };

/** A visible native listbox is a distinct form control, not a popup selector. */
function NativeListSelect({ className, onInvalid, onChange, ...props }: Props) {
  const invalid = useRef<{ field: HTMLSelectElement; message: string } | null>(null);
  useEffect(() => {
    if (invalid.current?.field.validationMessage === invalid.current?.message) invalid.current?.field.setCustomValidity("");
    invalid.current = null;
  }, [props.value]);
  return <select {...props} className={`xcss-input xcss-select-list${className ? ` ${className}` : ""}`}
    onInvalid={event => {
      if (!event.currentTarget.validity.customError) {
        const message = validationMessage(event.currentTarget);
        event.currentTarget.setCustomValidity(message);
        invalid.current = { field: event.currentTarget, message };
      }
      onInvalid?.(event);
    }} onChange={event => { invalid.current = null; event.currentTarget.setCustomValidity(""); onChange?.(event); }} />;
}

function PopupSelect({ className, style, id, autoFocus, tabIndex, onChange, onInvalid, ...props }: Props) {
  const generated = useId();
  const triggerId = id ?? `${generated}-select`;
  const panelId = `${generated}-options`, errorId = `${generated}-error`;
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const controlled = useRef(props.value);
  controlled.current = props.value;
  const signature = useRef("");
  const [snapshot, setSnapshot] = useState<Snapshot>({ items: [], selected: -1, disabled: !!props.disabled, label: "" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState("");
  const [labelledBy, setLabelledBy] = useState<string>();
  const [derivedLabel, setDerivedLabel] = useState<string>();
  const invalid = useRef<{ field: HTMLSelectElement; message: string } | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const synchronize = useCallback(() => {
    const field = native.current;
    if (!field) return;
    const items = Array.from(field.options, (option, index): Item => {
      const group = option.closest("optgroup");
      return { index, value: option.value, label: option.label, hidden: !!option.hidden || !!group?.hidden,
        disabled: option.disabled || !!group?.disabled, group: group?.label ?? "" };
    });
    const next = { items, selected: field.selectedIndex, disabled: field.matches(":disabled"), label: field.selectedOptions[0]?.label ?? "" };
    const key = JSON.stringify(next);
    if (signature.current !== key) { signature.current = key; setSnapshot(next); }
  }, []);
  const close = useCallback(() => {
    if (panel.current?.matches(":popover-open")) panel.current.hidePopover();
    setOpen(false); typed.current = { text: "", at: 0 };
  }, []);

  useLayoutEffect(() => { synchronize(); });
  useLayoutEffect(() => {
    if (props["aria-label"] || props["aria-labelledby"]) return;
    const labels = Array.from(trigger.current?.labels ?? []);
    const fieldLabel = labels[0];
    if (!fieldLabel) { setLabelledBy(undefined); setDerivedLabel(undefined); return; }
    const text = fieldLabel.querySelector<HTMLElement>(":scope > span:not(.xcss-select)");
    if (text) { text.id ||= `${generated}-label`; setLabelledBy(text.id); setDerivedLabel(undefined); }
    else {
      const copy = fieldLabel.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".xcss-select").forEach(node => node.remove());
      setLabelledBy(undefined); setDerivedLabel(copy.textContent?.trim() || undefined);
    }
  });
  useEffect(() => {
    if (invalid.current && invalid.current.field.validationMessage === invalid.current.message) {
      invalid.current.field.setCustomValidity(""); setMessage("");
    }
    invalid.current = null;
  }, [props.value]);
  useEffect(() => {
    const field = native.current!;
    const observer = new MutationObserver(synchronize);
    observer.observe(field, { subtree: true, childList: true, attributes: true });
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLFieldSetElement) observer.observe(parent, { attributes: true, attributeFilter: ["disabled"] });
    }
    // The browser performs its default reset after dispatching the event.
    // A microtask checkpoint can run before that default action completes.
    const reset = (event: Event) => field.ownerDocument.defaultView!.requestAnimationFrame(() => {
      if (event.defaultPrevented || native.current !== field) return;
      field.setCustomValidity(""); invalid.current = null; setMessage(""); close();
      if (controlled.current !== undefined) field.value = String(controlled.current);
      synchronize();
    });
    const form = field.form;
    form?.addEventListener("reset", reset);
    return () => { observer.disconnect(); form?.removeEventListener("reset", reset); };
  }, [close, synchronize, props.form]);
  useEffect(() => {
    if (snapshot.disabled) close();
    if (open && !snapshot.items.some(item => item.index === active && !item.disabled && !item.hidden)) {
      setActive(snapshot.items.find(item => !item.disabled && !item.hidden)?.index ?? -1);
    }
  }, [snapshot, open, active, close]);

  const position = useCallback(() => {
    const anchor = trigger.current!, popup = panel.current!;
    const rect = anchor.getBoundingClientRect();
    const viewport = anchor.ownerDocument.defaultView!;
    const margin = 8, gap = 4;
    const width = Math.min(rect.width, viewport.innerWidth - margin * 2);
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(margin, Math.min(rect.left, viewport.innerWidth - width - margin))}px`;
    const below = Math.max(0, viewport.innerHeight - rect.bottom - margin - gap);
    const above = Math.max(0, rect.top - margin - gap);
    const upwards = below < Math.min(180, popup.scrollHeight) && above > below;
    popup.style.maxHeight = `${Math.min(320, upwards ? above : below)}px`;
    const height = popup.getBoundingClientRect().height;
    popup.style.top = `${upwards ? Math.max(margin, rect.top - gap - height) : rect.bottom + gap}px`;
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    position();
    panel.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, snapshot, position]);
  useEffect(() => {
    if (!open) return;
    const document = trigger.current!.ownerDocument, view = document.defaultView!;
    const outside = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    view.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    view.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside);
      view.removeEventListener("resize", position); document.removeEventListener("scroll", position, true);
      view.removeEventListener("blur", close);
    };
  }, [open, close, position]);

  const show = (index = snapshot.selected) => {
    if (native.current!.matches(":disabled")) return;
    const enabled = snapshot.items.filter(item => !item.disabled && !item.hidden);
    setActive(enabled.some(item => item.index === index) ? index : enabled[0]?.index ?? -1);
    if (!panel.current!.matches(":popover-open")) panel.current!.showPopover();
    position(); setOpen(true);
  };
  const commit = (index: number) => {
    const field = native.current!;
    const item = snapshot.items.find(item => item.index === index);
    if (field.matches(":disabled") || !item || item.disabled || item.hidden) { close(); return; }
    if (field.selectedIndex !== index) {
      field.selectedIndex = index;
      // React's select change plugin receives a real event from the real
      // form control, preserving target/currentTarget/selectedOptions.
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    synchronize(); close();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (native.current!.matches(":disabled")) return;
    const enabled = snapshot.items.filter(item => !item.disabled && !item.hidden);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { show(event.key === "Home" ? enabled[0]?.index : event.key === "End" ? enabled.at(-1)?.index : snapshot.selected); return; }
      const index = enabled.findIndex(item => item.index === active);
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(enabled[next]?.index ?? -1); return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); if (open) commit(active); else show(); return;
    }
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { if (open) commit(active); return; }
    if (!event.ctrlKey && !event.altKey && !event.metaKey && [...event.key].length === 1) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - typed.current.at < 750 ? typed.current.text : "") + event.key.toLocaleLowerCase();
      typed.current = { text, at: now };
      const term = [...text].every(char => char === text[0]) ? text[0] : text;
      const from = enabled.findIndex(item => item.index === (open ? active : snapshot.selected));
      const ordered = [...enabled.slice(from + (term.length === 1 ? 1 : 0)), ...enabled.slice(0, from + (term.length === 1 ? 1 : 0))];
      const match = ordered.find(item => item.label.toLocaleLowerCase().startsWith(term));
      if (!open) show(match?.index); else if (match) setActive(match.index);
    }
  };
  return <span className="xcss-select">
    <button ref={trigger} id={triggerId} type="button" role="combobox" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={panelId} aria-activedescendant={open && active >= 0 ? `${panelId}-${active}` : undefined}
      aria-label={props["aria-label"] ?? derivedLabel} aria-labelledby={props["aria-labelledby"] ?? (props["aria-label"] ? undefined : labelledBy)}
      aria-describedby={[props["aria-describedby"], message ? errorId : undefined].filter(Boolean).join(" ") || undefined}
      aria-required={props.required || undefined} aria-invalid={message ? true : props["aria-invalid"]}
      disabled={snapshot.disabled} autoFocus={autoFocus} tabIndex={tabIndex} title={props.title} style={style}
      className={`xcss-input xcss-select-trigger${className ? ` ${className}` : ""}`}
      onClick={event => { event.preventDefault(); if (open) close(); else show(); }} onKeyDown={keyDown}>
      <span className="xcss-select-value">{snapshot.label || "\u00a0"}</span>
      <svg className="xcss-select-arrow" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 6 6 6-6 6" /></svg>
    </button>
    <select {...props} ref={native} id={`${generated}-native`} className="xcss-select-native" aria-hidden="true" tabIndex={-1}
      onChange={event => { invalid.current = null; event.currentTarget.setCustomValidity(""); setMessage(""); onChange?.(event); synchronize(); }}
      onInvalid={event => {
        event.preventDefault();
        if (!event.currentTarget.validity.customError) {
          const localized = validationMessage(event.currentTarget); event.currentTarget.setCustomValidity(localized);
          invalid.current = { field: event.currentTarget, message: localized };
        }
        onInvalid?.(event); setMessage(event.currentTarget.validationMessage); close();
        const field = event.currentTarget;
        const focusFirstInvalid = () => {
          if (native.current !== field) return;
          const first = field.form && Array.from(field.form.elements).find(control => {
            const candidate = control as HTMLInputElement;
            return candidate.willValidate && !candidate.validity.valid;
          });
          if (!field.form || first === field) trigger.current?.focus();
        };
        // Native validation can focus a later visible invalid input after this
        // hidden control's cancelled invalid event. Restore the true first
        // field only after that browser default action has finished.
        if (field.form) field.ownerDocument.defaultView!.requestAnimationFrame(focusFirstInvalid);
        else focusFirstInvalid();
      }} />
    <span ref={panel} id={panelId} popover="manual" role="listbox"
      aria-label={props["aria-label"] ?? derivedLabel}
      aria-labelledby={props["aria-labelledby"] ?? (props["aria-label"] ? undefined : labelledBy)}
      className="xcss-select-panel" data-xcss-select-open={open || undefined}
      onPointerDown={event => { if ((event.target as Element).closest("[role=option]")) event.preventDefault(); }}>
      {snapshot.items.filter(item => !item.hidden).map((item, index, visible) => <span key={item.index}>
        {item.group && item.group !== visible[index - 1]?.group && <span className="xcss-select-group" aria-hidden="true">{item.group}</span>}
        <span id={`${panelId}-${item.index}`} role="option" aria-selected={snapshot.selected === item.index}
          aria-disabled={item.disabled || undefined} data-option-index={item.index} data-active={active === item.index || undefined}
          className="xcss-select-option" onPointerMove={() => { if (!item.disabled) setActive(item.index); }}
          onClick={event => { event.preventDefault(); event.stopPropagation(); commit(item.index); }}>
          <span>{item.label}</span><span aria-hidden="true">{snapshot.selected === item.index ? "✓" : ""}</span>
        </span>
      </span>)}
    </span>
    {message && <span id={errorId} className="xcss-select-error" role="alert">{message}</span>}
  </span>;
}

export function Select(props: Props) {
  return props.multiple || (props.size ?? 0) > 1 ? <NativeListSelect {...props} /> : <PopupSelect {...props} />;
}
