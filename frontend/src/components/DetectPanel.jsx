import { useState } from "react";
import { Loader2, Plus, ScanSearch } from "lucide-react";

export default function DetectPanel({
  hasScene, objectsText, setObjectsText, hasLayers, missing, busy, onDetect,
}) {
  const [extra, setExtra] = useState("");
  const lines = objectsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const locked = !hasScene || Boolean(busy);

  const addOne = (e) => {
    e.preventDefault();
    const name = extra.trim();
    if (!name || locked) return;
    onDetect([name], "append");
    setExtra("");
  };

  return (
    <section className="section">
      <h2>Detect objects</h2>
      {!hasScene && <p className="hint-text">Generate or upload an image first.</p>}

      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="objects-input">Objects to find</label>
          <textarea
            id="objects-input"
            className="textarea"
            rows={6}
            value={objectsText}
            disabled={!hasScene}
            onChange={(e) => setObjectsText(e.target.value)}
            placeholder={"pirate ship\nvolcanic island\nocean\nsky"}
          />
          <p className="hint-text">
            One per line. Add a count to find several, like “seagull x3”.
          </p>
        </div>

        <button
          className="btn btn-primary btn-block"
          disabled={locked || lines.length === 0}
          onClick={() => onDetect(lines, "replace")}
        >
          {busy?.kind === "detect" ? (
            <><Loader2 size={16} className="spin" /> Detecting…</>
          ) : (
            <><ScanSearch size={16} /> Detect and segment</>
          )}
        </button>
        {hasLayers && <p className="hint-text">This replaces the current layers.</p>}

        {missing.length > 0 && (
          <p className="callout callout-warn">
            Couldn’t find: {missing.join(", ")}. Reword them, or lower the detection
            thresholds in Settings.
          </p>
        )}
      </div>

      <form className="add-row" onSubmit={addOne}>
        <input
          className="input"
          value={extra}
          disabled={!hasScene}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Add one object, e.g. mast"
          aria-label="Add one object by name"
        />
        <button className="btn" disabled={locked || !extra.trim()}>
          <Plus size={16} /> Add
        </button>
      </form>
    </section>
  );
}
