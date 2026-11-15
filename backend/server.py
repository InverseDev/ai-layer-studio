"""
AI Layer Studio - API server

The same pipeline as app.py (the Streamlit prototype), exposed as a REST API
for the React frontend:

  Llama 3.1        -> lists the objects in the scene
  FLUX (Cloudflare)-> generates the image
  Grounding DINO   -> finds each object BY NAME (a box around the whole object)
  SAM              -> turns each box into a pixel mask
  BiRefNet         -> cleans up the alpha edge (optional)
  ZIP / OpenRaster -> export

Run (from this folder):
    uvicorn server:app --port 8000
"""
import base64
import io
import json
import os
import re
import threading
import uuid
import zipfile
from collections import OrderedDict
from functools import lru_cache
from typing import List, Literal
from xml.sax.saxutils import quoteattr

import cv2
import numpy as np
import requests
import torch
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from rembg import new_session, remove

load_dotenv()

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct"
IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell"
ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN")

DINO_ID = "IDEA-Research/grounding-dino-tiny"   # "-base" is more accurate, ~2x the VRAM
SAM_ID = "facebook/sam-vit-base"                # "sam-vit-large" for better edges
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MAX_SCENES = 6                                  # oldest scene is dropped beyond this
INFER_LOCK = threading.Lock()                   # one model job at a time (protects VRAM)


# --------------------------------------------------------------------------- #
# Scenes (server-side replacement for Streamlit's session_state)
# --------------------------------------------------------------------------- #
class Scene:
    def __init__(self, img: Image.Image):
        self.id = uuid.uuid4().hex[:12]
        self.img = img
        self.emb = None          # SAM image embeddings, computed once per image
        self.layers = []
        self.next_id = 1


SCENES: "OrderedDict[str, Scene]" = OrderedDict()


def new_scene(img: Image.Image) -> Scene:
    scene = Scene(img)
    SCENES[scene.id] = scene
    while len(SCENES) > MAX_SCENES:
        SCENES.popitem(last=False)
    return scene


def get_scene(sid: str) -> Scene:
    scene = SCENES.get(sid)
    if scene is None:
        raise HTTPException(404, "This image is no longer on the server (it restarts clear "
                                 "everything). Generate or upload the image again.")
    return scene


def get_layer(scene: Scene, lid: int) -> dict:
    layer = next((l for l in scene.layers if l["id"] == lid), None)
    if layer is None:
        raise HTTPException(404, "That layer no longer exists.")
    return layer


def scene_json(scene: Scene) -> dict:
    return {"scene_id": scene.id, "width": scene.img.width, "height": scene.img.height}


# --------------------------------------------------------------------------- #
# Cloudflare Workers AI
# --------------------------------------------------------------------------- #
def cf_run(model: str, payload: dict, timeout: int = 120):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json=payload,
        timeout=timeout,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Cloudflare {model} -> HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    if not data.get("success", True):
        raise RuntimeError(f"Cloudflare error: {data.get('errors')}")
    return data["result"]


def refine_prompt(concept: str):
    """Expand the concept AND bias it toward easy-to-segment compositions.
    Returns (prompt, warning_or_None)."""
    sys_inst = (
        "You are an expert diffusion prompt engineer. Expand the concept into one detailed, "
        "cinematic image prompt. Keep every subject from the concept fully visible and uncropped, "
        "with clear silhouettes that separate it from the background. "
        "Output ONLY the prompt text, under 120 words."
    )
    try:
        out = cf_run(TEXT_MODEL, {
            "messages": [{"role": "system", "content": sys_inst},
                         {"role": "user", "content": concept}],
            "max_tokens": 300,
        })
        text = (out.get("response") or "").strip().strip('"')
        return text[:1900] or concept, None
    except Exception as e:  # fall back to the raw concept
        return concept, f"Prompt refinement failed, so your original text was used. ({e})"


def generate_image(prompt: str, steps: int) -> Image.Image:
    result = cf_run(IMAGE_MODEL, {"prompt": prompt, "steps": steps})
    return Image.open(io.BytesIO(base64.b64decode(result["image"]))).convert("RGB")


def list_objects(scene_text: str):
    """Ask the LLM for the distinct visual elements. Returns (items, warning_or_None)."""
    sys_inst = (
        "List the distinct visual elements in this image description. Reply with ONLY a JSON array "
        "of 3 to 8 short lowercase noun phrases (max 4 words each, singular), ordered foreground to "
        "background. Include big background elements such as sky or ocean as separate items. "
        'Example: ["pirate ship", "volcanic island", "ocean", "sky"]'
    )
    try:
        out = cf_run(TEXT_MODEL, {
            "messages": [{"role": "system", "content": sys_inst},
                         {"role": "user", "content": scene_text}],
            "max_tokens": 150,
        })
        raw = out.get("response", "")
        if not isinstance(raw, str):
            raw = json.dumps(raw)
        items = []
        m = re.search(r"\[.*?\]", raw, re.S)
        if m:
            try:
                items = [str(x) for x in json.loads(m.group(0))]
            except json.JSONDecodeError:
                pass
        if not items:
            items = [re.sub(r"^[\s\-*\d.\"']+|[\s\"',]+$", "", p) for p in re.split(r"[\n,]", raw)]
        seen, clean = set(), []
        for it in items:
            it = it.strip().lower()
            if it and it not in seen:
                seen.add(it)
                clean.append(it)
        return clean[:8], None
    except Exception as e:
        return [], f"Couldn't list the objects automatically. Type them in yourself. ({e})"


# --------------------------------------------------------------------------- #
# Models (loaded lazily, once per server process)
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def load_dino():
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
    proc = AutoProcessor.from_pretrained(DINO_ID)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(DINO_ID).to(DEVICE).eval()
    return proc, model


@lru_cache(maxsize=1)
def load_sam():
    from transformers import SamModel, SamProcessor
    proc = SamProcessor.from_pretrained(SAM_ID)
    model = SamModel.from_pretrained(SAM_ID).to(DEVICE).eval()
    return proc, model


@lru_cache(maxsize=1)
def load_birefnet():
    return new_session("birefnet-general")


# --------------------------------------------------------------------------- #
# Detection + segmentation (unchanged logic from app.py)
# --------------------------------------------------------------------------- #
def box_iou(a, b) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def nms(boxes, scores, thr=0.5):
    keep = []
    for i in np.argsort(-np.asarray(scores)):
        if all(box_iou(boxes[i], boxes[j]) < thr for j in keep):
            keep.append(int(i))
    return keep


@torch.no_grad()
def detect(img: Image.Image, phrase: str, box_thr: float, text_thr: float, max_n: int):
    """Open-vocabulary detection: returns [(xyxy box, score), ...] for one phrase."""
    proc, model = load_dino()
    text = phrase.lower().strip().rstrip(".") + "."
    inputs = proc(images=img, text=text, return_tensors="pt").to(DEVICE)
    outputs = model(**inputs)
    target = [(img.height, img.width)]
    try:  # newer transformers
        res = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=box_thr, text_threshold=text_thr,
            target_sizes=target)[0]
    except TypeError:  # older transformers
        res = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, box_threshold=box_thr, text_threshold=text_thr,
            target_sizes=target)[0]
    boxes = res["boxes"].cpu().numpy()
    scores = res["scores"].cpu().numpy()
    if len(boxes) == 0:
        return []
    boxes = np.clip(boxes, 0, [img.width, img.height, img.width, img.height])
    keep = nms(boxes, scores)[:max_n]
    return [(boxes[i], float(scores[i])) for i in keep]


@torch.no_grad()
def sam_embed(img: Image.Image):
    """Heavy part of SAM - run once per image, reuse for every click / box."""
    proc, model = load_sam()
    inputs = proc(img, return_tensors="pt").to(DEVICE)
    return model.get_image_embeddings(inputs["pixel_values"])


@torch.no_grad()
def sam_segment(img, emb, box=None, point=None, multimask=False):
    """Returns (masks[num_masks, H, W] bool, iou_scores[num_masks])."""
    proc, model = load_sam()
    kw = {}
    if box is not None:
        kw["input_boxes"] = [[[float(v) for v in box]]]
    if point is not None:
        kw["input_points"] = [[[float(point[0]), float(point[1])]]]
    inputs = proc(img, return_tensors="pt", **kw).to(DEVICE)
    inputs.pop("pixel_values", None)
    inputs.update({"image_embeddings": emb})
    out = model(**inputs, multimask_output=multimask)
    masks = proc.image_processor.post_process_masks(
        out.pred_masks.cpu(), inputs["original_sizes"].cpu(),
        inputs["reshaped_input_sizes"].cpu())[0][0].numpy()
    scores = out.iou_scores.cpu()[0, 0].numpy()
    return masks, scores


def clean_mask(mask: np.ndarray, seed=None) -> np.ndarray:
    """Drop stray specks: keep big connected components (and the one under `seed`)."""
    m = mask.astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n <= 2:
        return m.astype(bool)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = [i + 1 for i, a in enumerate(areas) if a >= 0.05 * areas.max()]
    if seed is not None and lab[seed[1], seed[0]] > 0:
        keep.append(int(lab[seed[1], seed[0]]))
    return np.isin(lab, keep)


def refine_alpha(img: Image.Image, mask: np.ndarray, pad: int = 24) -> np.ndarray:
    """BiRefNet matting restricted to the SAM mask -> soft, accurate edges.
    Interior stays solid from SAM; if BiRefNet disagrees badly, keep SAM's mask."""
    H, W = mask.shape
    ys, xs = np.where(mask)
    x0, x1 = int(max(0, xs.min() - pad)), int(min(W, xs.max() + 1 + pad))
    y0, y1 = int(max(0, ys.min() - pad)), int(min(H, ys.max() + 1 + pad))
    crop = img.crop((x0, y0, x1, y1))
    m = np.array(remove(crop, session=load_birefnet(), only_mask=True).convert("L"))
    full = np.zeros((H, W), np.uint8)
    full[y0:y1, x0:x1] = m
    k = max(3, int(0.01 * max(x1 - x0, y1 - y0))) | 1
    kernel = np.ones((k, k), np.uint8)
    m8 = mask.astype(np.uint8)
    refined = full * cv2.dilate(m8, kernel)
    if refined.sum() / 255.0 < 0.6 * m8.sum():  # BiRefNet treated it as background
        return (m8 * 255).astype(np.uint8)
    interior = cv2.erode(m8, kernel) * 255
    return np.maximum(refined, interior).astype(np.uint8)


def finalize_alpha(alpha: np.ndarray, shrink: int, feather: float) -> np.ndarray:
    a = alpha
    if shrink > 0:
        a = cv2.erode(a, np.ones((2 * shrink + 1, 2 * shrink + 1), np.uint8))
    if feather > 0:
        a = cv2.GaussianBlur(a, (0, 0), feather)
    return a


# --------------------------------------------------------------------------- #
# Layer bookkeeping
# --------------------------------------------------------------------------- #
def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return inter / union if union else 0.0


def find_duplicate(layers, mask, thr=0.85):
    for l in layers:
        if mask_iou(l["alpha"] > 127, mask) > thr:
            return l
    return None


def mask_polygons(m8: np.ndarray):
    """Outlines (with holes) as simple polygons, for the browser's SVG overlay."""
    contours, _ = cv2.findContours(m8, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    for c in contours:
        if cv2.contourArea(c) < 16:
            continue
        approx = cv2.approxPolyDP(c, max(1.0, 0.002 * cv2.arcLength(c, True)), True)
        if len(approx) >= 3:
            polys.append(approx.reshape(-1, 2).astype(int).tolist())
    return polys


def make_layer(scene: Scene, name: str, mask: np.ndarray, score: float, refine: bool):
    alpha = refine_alpha(scene.img, mask) if refine else (mask.astype(np.uint8) * 255)
    m8 = (alpha > 127).astype(np.uint8)
    ys, xs = np.where(m8)
    if len(xs) == 0:
        return None
    layer = {
        "id": scene.next_id, "name": name, "score": score, "alpha": alpha,
        "area": int(m8.sum()), "polygons": mask_polygons(m8),
        "box": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
    }
    scene.next_id += 1
    return layer


def layer_json(layer: dict) -> dict:
    return {k: layer[k] for k in ("id", "name", "area", "box", "polygons")} | {
        "score": round(layer["score"], 3)}


def parse_line(line: str):
    """'seagull x3' -> ('seagull', 3); 'pirate ship' -> ('pirate ship', None)"""
    m = re.match(r"^(.*?)\s*[x\u00d7]\s*(\d+)$", line.strip(), re.I)
    return (m.group(1).strip(), int(m.group(2))) if m and m.group(1) else (line.strip(), None)


def layer_at(layers, x, y):
    hits = [l for l in layers if l["alpha"][y, x] > 127]
    return min(hits, key=lambda l: l["area"]) if hits else None  # most specific wins


def ensure_embeddings(scene: Scene):
    if scene.emb is None:
        scene.emb = sam_embed(scene.img)


# --------------------------------------------------------------------------- #
# Rendering / export helpers
# --------------------------------------------------------------------------- #
def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "layer"


def png_bytes(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.save(b, format="PNG")
    return b.getvalue()


def crop_to_alpha(rgba: Image.Image):
    bbox = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return (rgba.crop(bbox), (bbox[0], bbox[1])) if bbox else (None, (0, 0))


def alpha_to_rgba(img: Image.Image, alpha: np.ndarray) -> Image.Image:
    return Image.fromarray(np.dstack([np.asarray(img), alpha]))


def layer_rgba(scene: Scene, layer, shrink, feather, crop=True):
    rgba = alpha_to_rgba(scene.img, finalize_alpha(layer["alpha"], shrink, feather))
    return crop_to_alpha(rgba)[0] if crop else rgba


def residual_alpha(layers):
    return 255 - np.max([l["alpha"] for l in layers], axis=0).astype(np.uint8)


def build_zip(scene: Scene, shrink, feather) -> bytes:
    buf = io.BytesIO()
    manifest = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("original.png", png_bytes(scene.img))
        for i, l in enumerate(sorted(scene.layers, key=lambda l: -l["area"])):
            rgba = layer_rgba(scene, l, shrink, feather, crop=False)  # full canvas: stacks aligned
            fname = f"layers/{i:02d}_{slug(l['name'])}.png"
            z.writestr(fname, png_bytes(rgba))
            manifest.append({"file": fname, "name": l["name"], "z_index": i,
                             "bbox_xyxy": l["box"], "detector_score": round(l["score"], 3)})
        z.writestr("layers/residual.png",
                   png_bytes(alpha_to_rgba(scene.img, residual_alpha(scene.layers))))
        z.writestr("manifest.json", json.dumps(
            {"width": scene.img.width, "height": scene.img.height, "layers": manifest}, indent=2))
    return buf.getvalue()


def build_ora(scene: Scene, shrink, feather) -> bytes:
    """OpenRaster: a real layered file (Krita, GIMP, MyPaint...). Bottom -> top = big -> small."""
    W, H = scene.img.size
    stack_items = [("original (hidden reference)", scene.img.convert("RGBA"), False)]
    if scene.layers:
        stack_items.append(("residual", alpha_to_rgba(scene.img, residual_alpha(scene.layers)), True))
    for l in sorted(scene.layers, key=lambda l: -l["area"]):
        stack_items.append((l["name"], layer_rgba(scene, l, shrink, feather, crop=False), True))

    buf = io.BytesIO()
    xml_layers = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        zi = zipfile.ZipInfo("mimetype")
        zi.compress_type = zipfile.ZIP_STORED  # must be first + uncompressed
        z.writestr(zi, "image/openraster")
        for i, (name, rgba, visible) in enumerate(stack_items):
            x = y = 0
            if visible:
                cropped, (x, y) = crop_to_alpha(rgba)
                if cropped is None:
                    continue
                rgba = cropped
            src = f"data/{i:03d}.png"
            z.writestr(src, png_bytes(rgba))
            vis = "visible" if visible else "hidden"
            xml_layers.append(
                f'<layer name={quoteattr(name)} src="{src}" x="{x}" y="{y}" '
                f'opacity="1.0" visibility="{vis}" composite-op="svg:src-over"/>')
        xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               f'<image version="0.0.3" w="{W}" h="{H}"><stack>'
               f'{"".join(reversed(xml_layers))}</stack></image>')  # first = top
        z.writestr("stack.xml", xml)
        z.writestr("mergedimage.png", png_bytes(scene.img))
        thumb = scene.img.copy()
        thumb.thumbnail((256, 256))
        z.writestr("Thumbnails/thumbnail.png", png_bytes(thumb))
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
app = FastAPI(title="AI Layer Studio API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Layer-Width", "X-Layer-Height"],
)


def stream(events):
    """Send a generator of dicts as newline-delimited JSON so the UI can show live progress."""
    def body():
        try:
            for ev in events():
                yield json.dumps(ev) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
    return StreamingResponse(body(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class GenerateReq(BaseModel):
    concept: str = Field(min_length=3, max_length=1000)
    refine: bool = True
    steps: int = Field(4, ge=1, le=8)


class DetectReq(BaseModel):
    objects: List[str]
    mode: Literal["replace", "append"] = "replace"
    box_threshold: float = Field(0.30, ge=0.05, le=0.9)
    text_threshold: float = Field(0.25, ge=0.05, le=0.9)
    instances: int = Field(1, ge=1, le=5)
    refine_edges: bool = True


class ClickReq(BaseModel):
    x: int
    y: int
    granularity: int = Field(3, ge=1, le=3)
    refine_edges: bool = True


@app.get("/api/health")
def health():
    return {
        "device": DEVICE,
        "gpu_name": torch.cuda.get_device_name(0) if DEVICE == "cuda" else None,
        "cloudflare_configured": bool(ACCOUNT_ID and API_TOKEN),
    }


@app.post("/api/generate")
def generate(req: GenerateReq):
    if not (ACCOUNT_ID and API_TOKEN):
        raise HTTPException(400, "Cloudflare credentials are missing. Add CLOUDFLARE_ACCOUNT_ID "
                                 "and CLOUDFLARE_API_TOKEN to backend/.env, then restart the API.")

    def events():
        warnings = []
        prompt = req.concept.strip()
        if req.refine:
            yield {"type": "status", "message": "Refining your prompt"}
            prompt, warn = refine_prompt(prompt)
            if warn:
                warnings.append(warn)
        yield {"type": "status", "message": "Rendering the image with FLUX"}
        img = generate_image(prompt, req.steps)
        yield {"type": "status", "message": "Listing the objects in the scene"}
        objects, warn = list_objects(prompt)
        if warn:
            warnings.append(warn)
        scene = new_scene(img)
        yield {"type": "result", **scene_json(scene), "prompt": prompt,
               "objects": objects, "warnings": warnings}

    return stream(events)


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(400, "That file couldn't be read as an image. Use a PNG, JPG or WebP.")
    im.thumbnail((1536, 1536))
    return scene_json(new_scene(im))


@app.get("/api/scenes/{sid}/image")
def scene_image(sid: str):
    scene = get_scene(sid)
    return Response(png_bytes(scene.img), media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


@app.post("/api/scenes/{sid}/detect")
def detect_layers(sid: str, req: DetectReq):
    scene = get_scene(sid)
    lines = [l.strip() for l in req.objects if l.strip()]
    if not lines:
        raise HTTPException(400, "Add at least one object to detect.")

    def events():
        with INFER_LOCK:
            yield {"type": "status", "message": "Preparing the image (first run downloads the models)"}
            ensure_embeddings(scene)
            base = [] if req.mode == "replace" else list(scene.layers)
            found, missing = [], []
            for i, line in enumerate(lines):
                phrase, n = parse_line(line)
                n = n or req.instances
                yield {"type": "progress", "done": i, "total": len(lines), "label": phrase}
                dets = detect(scene.img, phrase, req.box_threshold, req.text_threshold, n)
                if not dets:
                    missing.append(phrase)
                for k, (box, score) in enumerate(dets):
                    masks, _ = sam_segment(scene.img, scene.emb, box=box)
                    mask = clean_mask(masks[0])
                    if mask.mean() < 0.002:  # ignore specks
                        continue
                    if find_duplicate(base + found, mask):
                        continue
                    name = phrase if n == 1 else f"{phrase} #{k + 1}"
                    layer = make_layer(scene, name, mask, score, req.refine_edges)
                    if layer:
                        found.append(layer)
            yield {"type": "progress", "done": len(lines), "total": len(lines), "label": ""}
        scene.layers = found if req.mode == "replace" else scene.layers + found
        yield {
            "type": "result",
            "layers": [layer_json(l) for l in scene.layers],
            "missing": missing,
            "added": len(found),
            "selected_id": (found[0]["id"] if req.mode == "replace" else found[-1]["id"]) if found else None,
        }

    return stream(events)


@app.post("/api/scenes/{sid}/click")
def click_layer(sid: str, req: ClickReq):
    scene = get_scene(sid)
    x = int(np.clip(req.x, 0, scene.img.width - 1))
    y = int(np.clip(req.y, 0, scene.img.height - 1))
    hit = layer_at(scene.layers, x, y)
    if hit:
        return {"selected_id": hit["id"], "layer": None}
    # Nothing detected here -> SAM point prompt. Masks sorted small->large,
    # `granularity` picks how coarse (3 = largest = "whole object" guess).
    with INFER_LOCK:
        ensure_embeddings(scene)
        masks, scores = sam_segment(scene.img, scene.emb, point=(x, y), multimask=True)
        order = np.argsort([m.sum() for m in masks])
        idx = int(order[min(req.granularity - 1, len(order) - 1)])
        mask = clean_mask(masks[idx], seed=(x, y))
        dup = find_duplicate(scene.layers, mask)
        if dup:
            return {"selected_id": dup["id"], "layer": None}
        layer = make_layer(scene, f"selection ({x}, {y})", mask, float(scores[idx]), req.refine_edges)
    if layer is None:
        raise HTTPException(422, "Nothing could be cut out at that spot. Try clicking the object's centre.")
    scene.layers.append(layer)
    return {"selected_id": layer["id"], "layer": layer_json(layer)}


@app.delete("/api/scenes/{sid}/layers/{lid}")
def delete_layer(sid: str, lid: int):
    scene = get_scene(sid)
    scene.layers = [l for l in scene.layers if l["id"] != lid]
    return {"ok": True}


@app.get("/api/scenes/{sid}/layers/{lid}/png")
def layer_png(
    sid: str,
    lid: int,
    crop: bool = True,
    shrink: int = Query(1, ge=0, le=5),
    feather: float = Query(1.0, ge=0, le=4),
    download: bool = False,
):
    scene = get_scene(sid)
    layer = get_layer(scene, lid)
    rgba = layer_rgba(scene, layer, shrink, feather, crop)
    if rgba is None:
        raise HTTPException(409, "This layer is empty after edge shrink. Lower the shrink value in Settings.")
    headers = {"X-Layer-Width": str(rgba.width), "X-Layer-Height": str(rgba.height)}
    if download:
        suffix = "" if crop else "_full"
        headers["Content-Disposition"] = f'attachment; filename="{slug(layer["name"])}{suffix}.png"'
    return Response(png_bytes(rgba), media_type="image/png", headers=headers)


@app.get("/api/scenes/{sid}/export/{fmt}")
def export_layers(
    sid: str,
    fmt: Literal["zip", "ora"],
    shrink: int = Query(1, ge=0, le=5),
    feather: float = Query(1.0, ge=0, le=4),
):
    scene = get_scene(sid)
    if not scene.layers:
        raise HTTPException(400, "Detect or click at least one layer before exporting.")
    if fmt == "zip":
        data, mime = build_zip(scene, shrink, feather), "application/zip"
    else:
        data, mime = build_ora(scene, shrink, feather), "image/openraster"
    return Response(data, media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="layers.{fmt}"'})

from pathlib import Path
from fastapi.staticfiles import StaticFiles

dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=str(dist), html=True), name="static")