"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

/**
 * 16:9 image cropper modal for the featured-media admin form.
 *
 * The featured-media cards on the home page render at a fixed 16:9 ratio
 * with `object-cover`, so portrait or square images get center-cropped by
 * the browser — and admins have no control over which part shows. This
 * lets them frame the image at upload time, then stores the cropped result
 * (JPEG data URL) in `imageUrl` like any other upload.
 *
 * Pasted URL images skip this UI (we can't read cross-origin pixels into
 * a canvas without CORS); only File uploads route through here.
 */
export function ImageCropModal({
  src,
  onSave,
  onCancel,
}: {
  src: string;
  onSave: (croppedDataUrl: string) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  // Esc to cancel — small UX win.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const dataUrl = await renderCroppedImage(src, croppedAreaPixels);
      onSave(dataUrl);
    } catch (err) {
      console.error("crop failed", err);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        // Click outside the dialog cancels
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-neutral-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-white text-sm font-medium">Crop image</div>
            <div className="text-white/50 text-xs mt-0.5">
              Drag to reposition · scroll or use the slider to zoom · cards
              show 16:9
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-white/50 hover:text-white text-xs"
          >
            Cancel
          </button>
        </div>

        <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={16 / 9}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="contain"
            restrictPosition={false}
            showGrid
          />
        </div>

        <div className="px-5 py-4 flex flex-col gap-3 border-t border-white/10">
          <label className="flex items-center gap-3 text-xs text-white/60">
            <span className="w-12 shrink-0">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-[#1db954]"
            />
            <span className="w-10 text-right tabular-nums">
              {zoom.toFixed(2)}x
            </span>
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !croppedAreaPixels}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {busy ? "Cropping…" : "Save crop"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Render the user's selected crop region to a canvas and return a JPEG
 * data URL. We cap output at 1600×900 so we don't bloat the DB row even
 * if someone uploaded a 6000-pixel-wide source.
 */
async function renderCroppedImage(src: string, area: Area): Promise<string> {
  const img = await loadImage(src);
  const MAX_WIDTH = 1600;
  const scale = area.width > MAX_WIDTH ? MAX_WIDTH / area.width : 1;
  const outW = Math.round(area.width * scale);
  const outH = Math.round(area.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    outW,
    outH,
  );

  // JPEG at quality 0.9 — visually indistinguishable from PNG for photos
  // but ~5-10x smaller, which keeps the data URL well under the 5MB cap.
  return canvas.toDataURL("image/jpeg", 0.9);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Data URLs don't need crossOrigin; setting it doesn't hurt either.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load image"));
    img.src = src;
  });
}
