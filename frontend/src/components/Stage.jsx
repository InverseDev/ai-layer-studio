import { useMemo, useState } from "react";
import { Layers, Loader2, Sparkles, Upload } from "lucide-react";
import { api } from "../api.js";
import Switch from "./Switch.jsx";

const toPath = (layer) =>
  layer.polygons.map((poly) => "M" + poly.map((p) => p.join(",")).join("L") + "Z").join(" ");

export default function Stage({
  scene, layers, selectedId, onSelect, onBackgroundClick,
  showOutlines, onToggleOutlines, busy, onPickGenerate, onPickUpload,
}) {
  const [hoverId, setHoverId] = useState(null);

  const paths = useMemo(() => new Map(layers.map((l) => [l.id, toPath(l)])), [layers]);
  // Largest first, so smaller layers sit on top and win the click (same rule as the prototype).
  const sorted = useMemo(() => [...layers].sort((a, b) => b.area - a.area), [layers]);
  const selected = layers.find((l) => l.id === selectedId) || null;
  const hovered = layers.find((l) => l.id === hoverId) || null;
  const veil = busy && busy.kind !== "click";

  const clickBackground = (e) => {
    if (busy) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * scene.width);
    const y = Math.round(((e.clientY - r.top) / r.height) * scene.height);
    onBackgroundClick(Math.min(scene.width - 1, Math.max(0, x)), Math.min(scene.height - 1, Math.max(0, y)));
  };

  let hint = "Click anything in the image to cut it out, or detect objects on the left.";
  if (hovered) hint = `Click to select “${hovered.name}”`;
  else if (layers.length) hint = "Click a layer to select it, or click anywhere else to cut out something new.";

  return (
    <section className="stage">
      {scene && (
        <div className="stage-bar">
          <span className="stage-hint">{hint}</span>
          <div className="stage-bar-right">
            <span className="dims">{scene.width} × {scene.height} px</span>
            <Switch checked={showOutlines} onChange={onToggleOutlines} label="Outlines" />
          </div>
        </div>
      )}

      <div className="stage-body">
        {scene ? (
          <div
            className={"canvas" + (veil ? " dim" : "")}
            style={{ "--ratio": scene.width / scene.height }}
          >
            <img src={api.imageUrl(scene.id)} alt="The image being split into layers" draggable={false} />
            <svg
              className={"overlay" + (busy ? " busy" : "")}
              viewBox={`0 0 ${scene.width} ${scene.height}`}
              preserveAspectRatio="none"
              onClick={clickBackground}
            >
              <g>
                {sorted.map((l) => (
                  <path
                    key={l.id}
                    d={paths.get(l.id)}
                    fillRule="evenodd"
                    className={"hit" + (showOutlines ? " outlined" : "") + (hoverId === l.id ? " hover" : "")}
                    onMouseEnter={() => setHoverId(l.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!busy) onSelect(l.id);
                    }}
                  />
                ))}
              </g>
              {selected && (
                <g pointerEvents="none">
                  <path d={paths.get(selected.id)} fillRule="evenodd" className="sel-fill" />
                  <path d={paths.get(selected.id)} fillRule="evenodd" className="sel-ring" />
                  <path d={paths.get(selected.id)} fillRule="evenodd" className="sel-ants" />
                </g>
              )}
            </svg>
            {busy?.kind === "click" && (
              <div className="pill" role="status">
                <Loader2 size={14} className="spin" /> Cutting out your selection…
              </div>
            )}
          </div>
        ) : (
          !veil && (
            <div className="empty">
              <div className="empty-icon"><Layers size={26} /></div>
              <h2>Turn one image into editable layers</h2>
              <p>
                Generate a scene or upload your own, pick out the objects you want, then
                export transparent PNGs or a layered .ora file.
              </p>
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={onPickGenerate}>
                  <Sparkles size={16} /> Generate an image
                </button>
                <button className="btn" onClick={onPickUpload}>
                  <Upload size={16} /> Upload an image
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {veil && <BusyCard busy={busy} />}
    </section>
  );
}

function BusyCard({ busy }) {
  const titles = {
    generate: "Generating your image",
    upload: "Uploading your image",
    detect: "Detecting layers",
  };
  const determinate = busy.kind === "detect" && busy.total > 0;
  const pct = determinate ? Math.round((busy.done / busy.total) * 100) : 0;

  return (
    <div className="veil">
      <div className="busy-card" role="status" aria-live="polite">
        <div className="busy-title"><Loader2 size={16} className="spin" /> {titles[busy.kind]}</div>
        <p className="busy-msg">{busy.message}</p>
        <div className={"bar" + (determinate ? "" : " indet")}>
          <i style={determinate ? { width: `${pct}%` } : undefined} />
        </div>
        {determinate && (
          <p className="busy-count">{busy.done} of {busy.total} objects done</p>
        )}
      </div>
    </div>
  );
}
