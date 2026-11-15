import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Cpu, Layers, Moon, RefreshCw, SlidersHorizontal, Sun, X } from "lucide-react";
import { api } from "./api.js";
import { DEFAULTS, useSettings } from "./settings.js";
import SourcePanel from "./components/SourcePanel.jsx";
import DetectPanel from "./components/DetectPanel.jsx";
import Stage from "./components/Stage.jsx";
import Inspector from "./components/Inspector.jsx";
import SettingsDrawer from "./components/SettingsDrawer.jsx";

export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("ai-layer-studio-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ai-layer-studio-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const [settings, setSettings] = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState({ status: "checking" });

  const [sourceTab, setSourceTab] = useState("generate");
  const [scene, setScene] = useState(null);          // { id, width, height }
  const [prompt, setPrompt] = useState("");          // the prompt that was sent to FLUX
  const [objectsText, setObjectsText] = useState("");
  const [layers, setLayers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(null);            // { kind, message, done?, total? }

  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((kind, text) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    if (kind !== "error") setTimeout(() => dismiss(id), 8000);
  }, [dismiss]);

  const checkHealth = useCallback(() => {
    setHealth({ status: "checking" });
    api.health()
      .then((h) => setHealth({ status: "online", ...h }))
      .catch(() => setHealth({ status: "offline" }));
  }, []);
  useEffect(checkHealth, [checkHealth]);

  const startScene = (r) => {
    setScene({ id: r.scene_id, width: r.width, height: r.height });
    setLayers([]);
    setSelectedId(null);
    setMissing([]);
  };

  const generate = async (concept) => {
    setBusy({ kind: "generate", message: "Starting" });
    try {
      const r = await api.generate(
        { concept, refine: settings.refinePrompt, steps: settings.steps },
        (ev) => ev.type === "status" && setBusy({ kind: "generate", message: ev.message })
      );
      startScene(r);
      setPrompt(r.prompt);
      setObjectsText(r.objects.join("\n"));
      r.warnings.forEach((w) => notify("warn", w));
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file) => {
    setBusy({ kind: "upload", message: "Reading your image" });
    try {
      startScene(await api.upload(file));
      setPrompt("");
      setObjectsText("");
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const detect = async (lines, mode) => {
    if (!scene) return;
    setBusy({ kind: "detect", message: "Starting", done: 0, total: lines.length });
    try {
      const r = await api.detect(
        scene.id,
        {
          objects: lines,
          mode,
          box_threshold: settings.boxThreshold,
          text_threshold: settings.textThreshold,
          instances: settings.instances,
          refine_edges: settings.refineEdges,
        },
        (ev) => {
          if (ev.type === "status") setBusy((b) => b && { ...b, message: ev.message });
          if (ev.type === "progress") {
            setBusy((b) => b && {
              ...b,
              done: ev.done,
              total: ev.total,
              message: ev.label ? `Finding “${ev.label}”` : "Finishing up",
            });
          }
        }
      );
      setLayers(r.layers);
      setMissing(r.missing);
      setSelectedId((prev) =>
        r.selected_id ?? (r.layers.some((l) => l.id === prev) ? prev : null)
      );
      if (r.added === 0 && r.missing.length === 0) {
        notify("info", "Those objects matched layers you already have, so nothing new was added.");
      }
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const clickAt = async (x, y) => {
    setBusy({ kind: "click", message: "Cutting out your selection" });
    try {
      const r = await api.click(scene.id, {
        x, y, granularity: settings.granularity, refine_edges: settings.refineEdges,
      });
      if (r.layer) setLayers((ls) => [...ls, r.layer]);
      setSelectedId(r.selected_id);
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const removeLayer = async (id) => {
    try {
      await api.deleteLayer(scene.id, id);
      setLayers((ls) => ls.filter((l) => l.id !== id));
      setSelectedId((s) => (s === id ? null : s));
    } catch (e) {
      notify("error", e.message);
    }
  };

  const focusGenerate = () => {
    setSourceTab("generate");
    setTimeout(() => document.getElementById("concept-input")?.focus(), 0);
  };
  const openUpload = () => document.getElementById("upload-input")?.click();
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const cloudReady = health.status !== "online" || health.cloudflare_configured;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Layers size={17} /></span>
          AI Layer Studio
        </div>
        <div className="topbar-right">
          <StatusChip health={health} />
          <button
            className="btn btn-ghost"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontal size={16} /> Settings
          </button>
        </div>
      </header>

      {health.status === "offline" && (
        <div className="banner" role="alert">
          <AlertTriangle size={16} />
          <span>
            Can’t reach the API. In the <code>backend</code> folder, run{" "}
            <code>uvicorn server:app --port 8000</code>, then retry.
          </span>
          <button className="btn btn-sm" onClick={checkHealth}><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      <main className="workspace">
        <div className="rail">
          <SourcePanel
            tab={sourceTab}
            setTab={setSourceTab}
            prompt={prompt}
            busy={busy}
            cloudReady={cloudReady}
            onGenerate={generate}
            onUpload={upload}
          />
          <DetectPanel
            hasScene={Boolean(scene)}
            objectsText={objectsText}
            setObjectsText={setObjectsText}
            hasLayers={layers.length > 0}
            missing={missing}
            busy={busy}
            onDetect={detect}
          />
        </div>

        <Stage
          scene={scene}
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onBackgroundClick={clickAt}
          showOutlines={settings.showOutlines}
          onToggleOutlines={(v) => setSettings((s) => ({ ...s, showOutlines: v }))}
          busy={busy}
          onPickGenerate={focusGenerate}
          onPickUpload={openUpload}
        />

        <Inspector
          scene={scene}
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDelete={removeLayer}
          settings={settings}
        />
      </main>

      <SettingsDrawer
        open={settingsOpen}
        onClose={closeSettings}
        settings={settings}
        setSettings={setSettings}
        onReset={() => setSettings(DEFAULTS)}
      />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <span>{t.text}</span>
            <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss message">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ health }) {
  if (health.status === "checking") {
    return <span className="chip"><span className="dot dot-idle" /> Connecting</span>;
  }
  if (health.status === "offline") {
    return <span className="chip chip-bad"><span className="dot dot-bad" /> API offline</span>;
  }
  const gpu = health.device === "cuda";
  return (
    <span
      className="chip"
      title={gpu
        ? "Models run on your GPU."
        : "No GPU found. Models run on the CPU, so detection will be slow."}
    >
      <span className={"dot " + (gpu ? "dot-ok" : "dot-warn")} />
      <Cpu size={14} /> {gpu ? health.gpu_name || "GPU" : "CPU"}
    </span>
  );
}