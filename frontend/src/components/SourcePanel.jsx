import { useState } from "react";
import { ImageUp, Loader2, Sparkles } from "lucide-react";

export default function SourcePanel({ tab, setTab, prompt, busy, cloudReady, onGenerate, onUpload }) {
  const [concept, setConcept] = useState("");
  const [dragging, setDragging] = useState(false);
  const working = Boolean(busy);
  const canGenerate = concept.trim().length >= 3 && !working && cloudReady;

  const submit = (e) => {
    e.preventDefault();
    if (canGenerate) onGenerate(concept.trim());
  };

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be chosen again
    if (file && !working) onUpload(file);
  };

  const drop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !working) onUpload(file);
  };

  return (
    <section className="section">
      <h2>Image</h2>

      <div className="seg" role="tablist" aria-label="Image source">
        <button role="tab" aria-selected={tab === "generate"} onClick={() => setTab("generate")}>
          Generate
        </button>
        <button role="tab" aria-selected={tab === "upload"} onClick={() => setTab("upload")}>
          Upload
        </button>
      </div>

      {tab === "generate" ? (
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="concept-input">Scene concept</label>
            <textarea
              id="concept-input"
              className="textarea"
              rows={4}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="A detailed pirate ship sailing toward a volcanic island"
            />
          </div>

          {!cloudReady && (
            <p className="callout callout-warn">
              Add <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_API_TOKEN</code> to{" "}
              <code>backend/.env</code> and restart the API to generate images. Uploading still works.
            </p>
          )}

          <button className="btn btn-primary btn-block" disabled={!canGenerate}>
            {busy?.kind === "generate" ? (
              <><Loader2 size={16} className="spin" /> Generating…</>
            ) : (
              <><Sparkles size={16} /> Generate image</>
            )}
          </button>

          {prompt && (
            <details className="details">
              <summary>Prompt sent to FLUX</summary>
              <p>{prompt}</p>
            </details>
          )}
        </form>
      ) : (
        <label
          className={"dropzone" + (dragging ? " drag" : "")}
          htmlFor="upload-input"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <ImageUp size={22} />
          <strong>Drop an image or browse</strong>
          <span>PNG, JPG or WebP. Images over 1536 px are scaled down.</span>
        </label>
      )}

      {/* Always mounted so the empty-state button on the canvas can open it. */}
      <input
        id="upload-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={pick}
      />
    </section>
  );
}
