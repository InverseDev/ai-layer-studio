import { useEffect, useRef } from "react";
import { RotateCcw, X } from "lucide-react";
import Switch from "./Switch.jsx";

function Range({ id, label, help, value, min, max, step = 1, format, onChange }) {
  return (
    <div className="field">
      <div className="row">
        <label className="label" htmlFor={id}>{label}</label>
        <output className="value">{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {help && <p className="hint-text">{help}</p>}
    </div>
  );
}

function Toggle({ label, help, checked, onChange }) {
  return (
    <div className="field">
      <div className="row">
        <span className="label">{label}</span>
        <Switch checked={checked} onChange={onChange} ariaLabel={label} />
      </div>
      {help && <p className="hint-text">{help}</p>}
    </div>
  );
}

export default function SettingsDrawer({ open, onClose, settings, setSettings, onReset }) {
  const closeRef = useRef(null);
  const set = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-wrap">
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="drawer-head">
          <h2>Settings</h2>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="group">
            <h3>Image generation</h3>
            <Toggle
              label="Refine prompt with Llama"
              help="Rewrites your concept so every subject stays fully visible and easy to separate."
              checked={settings.refinePrompt}
              onChange={set("refinePrompt")}
            />
            <Range id="s-steps" label="FLUX steps" min={1} max={8} value={settings.steps}
              help="More steps add detail but take longer." onChange={set("steps")} />
          </section>

          <section className="group">
            <h3>Detection</h3>
            <Range id="s-box" label="Box threshold" min={0.1} max={0.6} step={0.05}
              value={settings.boxThreshold} format={(v) => v.toFixed(2)}
              help="Higher finds fewer, more confident objects." onChange={set("boxThreshold")} />
            <Range id="s-text" label="Text threshold" min={0.1} max={0.6} step={0.05}
              value={settings.textThreshold} format={(v) => v.toFixed(2)}
              help="Higher requires the name to match more closely." onChange={set("textThreshold")} />
            <Range id="s-inst" label="Instances per object" min={1} max={5} value={settings.instances}
              help="Override per line with a count, like “seagull x4”." onChange={set("instances")} />
            <Toggle
              label="Refine edges with BiRefNet"
              help="Cleaner edges on rigging, hair and soft boundaries. Slower."
              checked={settings.refineEdges}
              onChange={set("refineEdges")}
            />
            <Range id="s-gran" label="Click fallback size" min={1} max={3} value={settings.granularity}
              format={(v) => ({ 1: "Small part", 2: "Medium", 3: "Whole object" })[v]}
              help="Used when you click something that wasn’t detected."
              onChange={set("granularity")} />
          </section>

          <section className="group">
            <h3>Cut-out edges</h3>
            <Range id="s-shrink" label="Edge shrink" min={0} max={5} value={settings.shrink}
              format={(v) => `${v} px`} help="Removes the background halo around cut-outs."
              onChange={set("shrink")} />
            <Range id="s-feather" label="Edge feather" min={0} max={4} step={0.5} value={settings.feather}
              format={(v) => `${v.toFixed(1)} px`} help="Softens the edge. Previews and exports update immediately."
              onChange={set("feather")} />
          </section>
        </div>

        <footer className="drawer-foot">
          <button className="btn" onClick={onReset}><RotateCcw size={15} /> Reset to defaults</button>
        </footer>
      </aside>
    </div>
  );
}
