import { useEffect, useState } from "react";

const KEY = "ai-layer-studio:settings:v1";

export const DEFAULTS = {
  refinePrompt: true,   // rewrite the concept with Llama before generating
  steps: 4,             // FLUX steps
  boxThreshold: 0.3,    // Grounding DINO box threshold
  textThreshold: 0.25,  // Grounding DINO text threshold
  instances: 1,         // default instances per object
  refineEdges: true,    // BiRefNet edge cleanup
  granularity: 3,       // SAM fallback: 1 = small part, 3 = whole object
  showOutlines: true,   // draw layer outlines on the image
  shrink: 1,            // edge shrink in px
  feather: 1,           // edge feather in px
};

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return DEFAULTS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings last for this session only */
    }
  }, [settings]);
  return [settings, setSettings];
}
