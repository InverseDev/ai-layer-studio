# LayerLock AI 🎨
### Turn AI-Generated Images into Fully Editable, Layer-Based Artwork.

**LayerLock AI** is an AI-powered illustration generation and editing platform that transforms flat, AI-generated images into structured, independently editable layers. Instead of receiving a single flattened image, users can select individual objects, separate them into transparent layers, reconstruct the background, and edit every element independently.

---

## 1. The Problem Statement

AI image-generation tools have made creating digital artwork easier than ever. However, they share a significant limitation: most generate images as a single, flattened output.

This creates a problem for digital artists, designers, and content creators who want to modify their generated artwork.

For example:
- Want to move a tree in an AI-generated landscape? You may need to regenerate the entire image.
- Want to change the colour of a character's clothing? You cannot directly edit that object independently.
- Want to remove an object while preserving the background? You need additional image-editing work.
- Want to reuse individual elements in another design? You have to manually extract them.

Traditional image editors provide layer-based editing, but users generally need to separate and organize the objects themselves.

**The core problem is the gap between AI-powered image generation and flexible, layer-based image editing.**

## 2. Our Solution

LayerLock AI bridges this gap by introducing an intelligent image-to-layers workflow.

Users can generate an illustration using an AI image-generation model and transform the resulting flat image into multiple independently editable components.

Our platform allows users to:

1. **Generate:** Create illustrations from text prompts using AI.
2. **Select:** Click on individual objects within the generated image.
3. **Separate:** Extract selected objects into independent transparent PNG layers.
4. **Reconstruct:** Remove selected objects and reconstruct the background.
5. **Edit:** Move, resize, rotate, rename, reorder, hide, show, and adjust the opacity of individual layers.
6. **Export:** Download the complete editable project, including the original image, reconstructed background, individual layers, preview, and project metadata.

The result is an editable composition rather than a single flattened image.

## 3. What Makes LayerLock AI Different?

LayerLock AI focuses on making AI-generated artwork editable after generation.

Unlike conventional AI image generators that primarily focus on producing the final image, LayerLock AI focuses on what users can do with that image afterward.

Our approach combines:

- AI-powered image generation.
- Interactive object selection and segmentation.
- Background reconstruction.
- Layer-based editing.
- Structured project export.

**Our goal is not just to generate better images, but to give users greater control over the images they generate.**

## 4. Key Features

| Feature | Description |
|---|---|
| AI Illustration Generation | Generate illustrations using text prompts. |
| Interactive Object Selection | Select objects directly from the generated image. |
| AI Object Segmentation | Extract selected objects into transparent PNG layers. |
| Background Reconstruction | Reconstruct the background after removing selected objects. |
| Layer-Based Editor | Edit individual objects independently. |
| Layer Management | Rename, reorder, hide, show, and delete layers. |
| Transform Controls | Move, resize, rotate, and adjust opacity. |
| Recombination Verification | Compare the reconstructed composition with the original image. |
| Project Export | Export artwork, background, layers, preview, and project metadata in a ZIP file. |

## 5. How It Works

The LayerLock AI workflow consists of the following stages:

**Stage 1 — Image Generation**

The user enters a text prompt. The backend communicates with an image-generation model and returns an illustration.

**Stage 2 — Object Selection**

The generated illustration appears in an interactive preview. Users click on the objects they want to separate.

**Stage 3 — Object Segmentation**

The backend processes the selected coordinates and extracts the corresponding objects as transparent PNG images.

**Stage 4 — Background Reconstruction**

The selected objects are removed from the original image, and the missing background regions are reconstructed.

**Stage 5 — Layer-Based Editing**

The reconstructed background and extracted objects are loaded into an interactive editor. Users can independently manipulate each layer.

**Stage 6 — Export**

The final composition can be exported as a ZIP package containing the original artwork, reconstructed background, individual transparent layers, preview, and project metadata.

## 6. System Architecture

```text
                 USER
                   |
                   v
          REACT FRONTEND
                   |
          Text Prompt / Selection
                   |
                   v
             FASTAPI BACKEND
                   |
          +--------+--------+
          |        |        |
          v        v        v
       Image   Segmentation Background
     Generation   Model    Reconstruction
          |        |        |
          +--------+--------+
                   |
                   v
          IMAGE / LAYER DATA
                   |
                   v
          REACT LAYER EDITOR
                   |
          +--------+--------+
          |        |        |
          v        v        v
         Move    Resize   Rotate
          |        |        |
          +--------+--------+
                   |
                   v
             EXPORT PROJECT
```

## 7. Technology Stack

### Frontend
- **React.js** — User interface and application components.
- **Vite** — Frontend development and build tooling.
- **JavaScript** — Application logic.
- **Konva.js / React-Konva** — Interactive canvas and layer manipulation.
- **Axios** — Communication with the backend.
- **JSZip** — Project ZIP generation.

### Backend
- **Python** — Core backend logic.
- **FastAPI** — REST API and backend services.
- **SQLAlchemy** — Database operations and project management.
- **Pillow (PIL)** — Image processing and manipulation.
- **AI Image Generation API** — Illustration generation.
- **Image Segmentation Model/API** — Object extraction.
- **Background Reconstruction / Inpainting** — Removal and reconstruction of image regions.

### Database and Storage
- **SQLite / SQLAlchemy** — Initial project metadata and database management.
- **PNG** — Transparent image layers and image assets.
- **JSON** — Project structure and layer metadata.

## 8. Project Structure

```text
LayerLockAI/
│
├── backend/
│   └── app/
│       ├── main.py
│       ├── database.py
│       ├── models.py
│       └── routes/
│           └── processing.py
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── utils/
│   ├── package.json
│   └── vite.config.js
│
├── venv312/
├── README.md
└── .gitignore
```

## 9. Getting Started

### Prerequisites

- Python 3.12
- Node.js (LTS)
- npm
- Git

### Backend Setup

Open a terminal in the project root:

```bash
# Activate virtual environment
.\venv312\Scripts\Activate.ps1

# Install dependencies
pip install -r backend/requirements.txt

# Start FastAPI
python -m uvicorn app.main:app --reload --app-dir backend --port 8000
```

Backend API documentation:

```text
http://localhost:8000/docs
```

### Frontend Setup

Open another terminal:

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
copy .env.example .env
```

Configure `.env`:

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_USE_MOCK=false
```

Start the frontend:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

**Note:** The backend must implement the API endpoints expected by the frontend. See `API_CONTRACT.md` for the integration contract.

## 10. Current Development Status

LayerLock AI is being developed as a modular application.

| Component | Status |
|---|---|
| React frontend and UI | Developed; browser testing pending |
| Interactive layer editor | Implemented in frontend |
| Mock image generation workflow | Implemented |
| FastAPI backend | Under development |
| Database integration | Under development |
| Real AI image generation | Backend integration required |
| Real object segmentation | Backend integration required |
| Background reconstruction | Backend integration required |
| End-to-end integration | Pending |

The frontend currently supports mock mode, allowing the interface and editing workflow to be tested independently of the backend.

## 11. Future Scope

We envision expanding LayerLock AI beyond basic illustration editing.

Potential future improvements include:

- Automatic detection and separation of all objects without manual selection.
- Semantic layer identification and intelligent naming.
- More advanced AI-powered background reconstruction.
- Support for complex illustrations and multiple art styles.
- Export to professional design formats and integration with existing creative tools.
- Editable vector-based output where technically feasible.
- Cloud-based project storage and collaboration.
- AI-assisted editing through natural-language instructions.

## 12. Our Vision

We believe AI-generated content should not be limited to static, uneditable outputs.

Digital artists and creators should have the freedom to experiment, modify, rearrange, and reuse every element of their artwork.

**LayerLock AI aims to make AI-generated artwork editable, flexible, and creator-controlled.**

Instead of simply generating an image, we want to give users control over every layer of their creativity.

---

## Team

**Project:** LayerLock AI  
**Category:** Artificial Intelligence / Creative Technology  
**Event:** GeNarrative Clash 2026

Built with the goal of making AI-generated creativity more accessible and editable.

---

*LayerLock AI — Generate. Separate. Edit. Create.*
