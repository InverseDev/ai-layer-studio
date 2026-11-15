import { useEffect, useRef, useState } from "react";
import { Download, FileArchive, Layers, Loader2, Trash2 } from "lucide-react";
import { api, errorFrom } from "../api.js";

// Fetches the cut-out PNG for the selected layer; re-fetches (debounced) when the edge settings change.
function usePreview(sceneId, layerId, shrink, feather) {
  const [state, setState] = useState({ id: null, url: null, w: 0, h: 0, error: null, loading: false });
  const urlRef = useRef(null);

  useEffect(() => {
    if (!sceneId || layerId == null) {
      setState({ id: null, url: null, w: 0, h: 0, error: null, loading: false });
      return undefined;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch(api.layerUrl(sceneId, layerId, { crop: true, shrink, feather }), {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(await errorFrom(res));
        const url = URL.createObjectURL(await res.blob());
        const old = urlRef.current;
        urlRef.current = url;
        if (old) URL.revokeObjectURL(old);
        setState({
          id: layerId,
          url,
          w: Number(res.headers.get("X-Layer-Width")),
          h: Number(res.headers.get("X-Layer-Height")),
          error: null,
          loading: false,
        });
      } catch (e) {
        if (e.name !== "AbortError") setState({ id: layerId, url: null, w: 0, h: 0, error: e.message, loading: false });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [sceneId, layerId, shrink, feather]);

  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);
  return state;
}

export default function Inspector({ scene, layers, selectedId, onSelect, onDelete, settings }) {
  const selected = layers.find((l) => l.id === selectedId) || null;
  const edge = { shrink: settings.shrink, feather: settings.feather };
  const raw = usePreview(scene?.id, selected?.id, settings.shrink, settings.feather);
  const preview = raw.id === selected?.id ? raw : { ...raw, url: null, error: null, loading: true };
  const canExport = Boolean(scene) && layers.length > 0;

  const exportLink = (format) => (canExport ? api.exportUrl(scene.id, format, edge) : undefined);
  const blockIfEmpty = (e) => { if (!canExport) e.preventDefault(); };

  return (
    <aside className="inspector">
      <section className="section">
        <div className="section-head">
          <h2>Layers</h2>
          {layers.length > 0 && <span className="count">{layers.length}</span>}
        </div>

        {layers.length === 0 ? (
          <p className="hint-text">
            No layers yet. Detect objects on the left, or click anywhere on the image.
          </p>
        ) : (
          <ul className="layer-list">
            {layers.map((l) => (
              <li key={l.id} className={l.id === selectedId ? "layer-row active" : "layer-row"}>
                <button className="layer-main" onClick={() => onSelect(l.id)} aria-pressed={l.id === selectedId}>
                  <span className="layer-name">{l.name}</span>
                  <span className="layer-meta">{l.box[2] - l.box[0]} × {l.box[3] - l.box[1]} px</span>
                </button>
                <button className="icon-btn" onClick={() => onDelete(l.id)} aria-label={`Delete layer ${l.name}`}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="section">
          <h2>Selected layer</h2>
          <div className="preview checker">
            {preview.url && <img src={preview.url} alt={`${selected.name} on a transparent background`} />}
            {preview.loading && !preview.url && <Loader2 className="spin" size={20} />}
            {preview.error && <p className="preview-error">{preview.error}</p>}
          </div>
          {preview.url && (
            <p className="caption">{selected.name} · {preview.w} × {preview.h} px</p>
          )}
          <div className="stack">
            <a
              className="btn btn-block"
              aria-disabled={!preview.url}
              href={preview.url ? api.layerUrl(scene.id, selected.id, { crop: true, download: true, ...edge }) : undefined}
              onClick={(e) => !preview.url && e.preventDefault()}
            >
              <Download size={16} /> Download PNG, cropped
            </a>
            <a
              className="btn btn-block"
              aria-disabled={!preview.url}
              href={preview.url ? api.layerUrl(scene.id, selected.id, { crop: false, download: true, ...edge }) : undefined}
              onClick={(e) => !preview.url && e.preventDefault()}
            >
              <Download size={16} /> Download PNG, full canvas
            </a>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Export all layers</h2>
        <p className="hint-text">Every layer, stacked and aligned to the original image.</p>
        <div className="stack">
          <a className="export" aria-disabled={!canExport} href={exportLink("zip")} onClick={blockIfEmpty}>
            <FileArchive size={18} />
            <span><b>layers.zip</b><small>Full-canvas PNGs, the original and a manifest.json</small></span>
          </a>
          <a className="export" aria-disabled={!canExport} href={exportLink("ora")} onClick={blockIfEmpty}>
            <Layers size={18} />
            <span><b>layers.ora</b><small>One layered file for Krita, GIMP or MyPaint</small></span>
          </a>
        </div>
      </section>
    </aside>
  );
}
