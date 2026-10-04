import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { BTN } from "../../game/sim/types";
import type { InputPipe } from "../runtime/input-pipe";

interface PadSpec {
  id: string;
  label: string;
  hint: string;
  bits: number;
  tint: string;
  glow: string;
  glyph: string;
}

const PADS: PadSpec[] = [
  { id: "attack", label: "ATTACK", hint: "hit", bits: BTN.ATTACK, tint: "#ff5a4d", glow: "#ff8a6b", glyph: "A" },
  { id: "special", label: "SPECIAL", hint: "move", bits: BTN.SPECIAL, tint: "#8b6bff", glow: "#b9a4ff", glyph: "S" },
  { id: "jump", label: "JUMP", hint: "hold = high", bits: BTN.JUMP, tint: "#3bd978", glow: "#8bf3b3", glyph: "▲" },
  { id: "shield", label: "SHIELD", hint: "block", bits: BTN.SHIELD, tint: "#36b9ff", glow: "#92dcff", glyph: "◉" },
  { id: "grab", label: "GRAB", hint: "throw", bits: BTN.SHIELD | BTN.ATTACK, tint: "#ffb62e", glow: "#ffd98a", glyph: "✋" },
];

interface PadButtonProps {
  spec: PadSpec;
  pipe: InputPipe;
  disabled: boolean;
  haptic: boolean;
  showHints: boolean;
}

/** One thumb button: pointer capture, multi-touch safe, releases on every kind of cancellation. */
const PadButton = ({ spec, pipe, disabled, haptic, showHints }: PadButtonProps) => {
  const [pressed, setPressed] = useState(false);
  const pointerRef = useRef<number | null>(null);

  const release = useCallback(() => {
    if (pointerRef.current === null) return;
    pointerRef.current = null;
    setPressed(false);
    pipe.release(spec.bits);
  }, [pipe, spec.bits]);

  // Never leave a button held when disabled or unmounted.
  useEffect(() => {
    if (!disabled || pointerRef.current === null) return;
    pointerRef.current = null;
    pipe.release(spec.bits);
  }, [disabled, pipe, spec.bits]);
  useEffect(() => release, [release]);
  const shown = pressed && !disabled;

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    pipe.noteTouchEvent();
    if (disabled || pointerRef.current !== null) return;
    pointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone; the up/cancel handlers still run.
    }
    setPressed(true);
    pipe.press(spec.bits);
    if (haptic && navigator.vibrate) navigator.vibrate(7);
  };
  const onEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pipe.noteTouchEvent();
    if (pointerRef.current !== event.pointerId) return;
    release();
  };

  return (
    <div
      role="button"
      aria-label={spec.label}
      aria-pressed={shown}
      className={`ab-pad ab-pad-${spec.id}`}
      data-pressed={shown}
      data-disabled={disabled}
      style={{ "--tint": spec.tint, "--glow": spec.glow } as CSSProperties}
      onPointerDown={onDown}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onLostPointerCapture={onEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="ab-pad-glyph">{spec.glyph}</span>
      <span className="ab-pad-label">{spec.label}</span>
      {showHints && <span className="ab-pad-hint">{spec.hint}</span>}
    </div>
  );
};

interface Props {
  pipe: InputPipe;
  disabled: boolean;
  haptic: boolean;
  mirrored: boolean;
  showHints: boolean;
  accent: string;
}

/**
 * Touch control surface: floating analog stick on one side, five big buttons on
 * the other. The stick is driven imperatively (refs + transforms) so moving a
 * thumb never triggers a React render.
 */
export const ControlSurface = ({ pipe, disabled, haptic, mirrored, showHints, accent }: Props) => {
  const zoneRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const radiusRef = useRef(70);
  const [active, setActive] = useState(false);

  const releaseStick = useCallback(() => {
    if (pointerRef.current === null && !active) return;
    pointerRef.current = null;
    setActive(false);
    pipe.setStick(0, 0);
  }, [pipe, active]);

  // When input is disabled (countdown, blur, phase change) drop the touch and neutralise the stick.
  // The visual `active` flag is masked by `disabled` below, so no state is set from an effect.
  useEffect(() => {
    if (!disabled) return;
    pointerRef.current = null;
    pipe.setStick(0, 0);
  }, [disabled, pipe]);

  const radius = (): number => {
    const zone = zoneRef.current;
    if (!zone) return 70;
    const u = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(52, Math.min(96, u * 0.19));
  };

  const place = (x: number, y: number, dx: number, dy: number): void => {
    const base = baseRef.current;
    const knob = knobRef.current;
    const zone = zoneRef.current;
    if (!base || !knob || !zone) return;
    const rect = zone.getBoundingClientRect();
    base.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px)`;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const update = (clientX: number, clientY: number): void => {
    const r = radiusRef.current;
    let dx = clientX - originRef.current.x;
    let dy = clientY - originRef.current.y;
    const mag = Math.hypot(dx, dy);
    if (mag > r) {
      dx = (dx / mag) * r;
      dy = (dy / mag) * r;
    }
    place(originRef.current.x, originRef.current.y, dx, dy);
    pipe.setStick(dx / r, dy / r);
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    pipe.noteTouchEvent();
    if (disabled || pointerRef.current !== null) return;
    pointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // see PadButton
    }
    radiusRef.current = radius();
    originRef.current = { x: event.clientX, y: event.clientY };
    setActive(true);
    // Defer visuals until the base node is mounted visible.
    requestAnimationFrame(() => place(event.clientX, event.clientY, 0, 0));
    pipe.setStick(0, 0);
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    pipe.noteTouchEvent();
    if (pointerRef.current !== event.pointerId) return;
    event.preventDefault();
    // Use coalesced events so fast flicks keep their full resolution.
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const last = coalesced && coalesced.length ? coalesced[coalesced.length - 1] : event.nativeEvent;
    update(last.clientX, last.clientY);
  };
  const onEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pipe.noteTouchEvent();
    if (pointerRef.current !== event.pointerId) return;
    releaseStick();
  };

  return (
    <div className="ab-controls" dir={mirrored ? "rtl" : "ltr"} style={{ "--accent": accent } as CSSProperties}>
      <div
        ref={zoneRef}
        className="ab-stick-zone"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onLostPointerCapture={onEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!(active && !disabled) && <div className="ab-stick-rest" aria-hidden><span>{showHints ? "move" : ""}</span></div>}
        <div ref={baseRef} className="ab-stick-base" data-active={active && !disabled} aria-hidden>
          <div ref={knobRef} className="ab-stick-knob" />
        </div>
      </div>
      <div className="ab-pads">
        {PADS.map((spec) => (
          <PadButton key={spec.id} spec={spec} pipe={pipe} disabled={disabled} haptic={haptic} showHints={showHints} />
        ))}
      </div>
    </div>
  );
};
