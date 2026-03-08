/**
 * Web Worker for face detection using MediaPipe.
 *
 * Offloads face detection from the main/UI thread so that
 * the pilot control panel stays responsive.
 *
 * Also implements ROI (Region of Interest) tracking:
 * after the first detection, subsequent frames are cropped
 * around the last known face position — much fewer pixels
 * to process. Falls back to full-frame scan when the face
 * is lost.
 */

import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision'

let detector: FaceDetector | null = null

// --- ROI state ---
let lastBox: { x: number; y: number; w: number; h: number } | null = null
const ROI_PADDING = 1.8 // expand ROI box by this factor on each side
const ROI_MISS_LIMIT = 5 // full-frame fallback after this many consecutive misses
let roiMisses = 0

// --- Message types ---
interface InitMessage {
  type: 'init'
  wasmPath: string
  modelPath: string
}

interface DetectMessage {
  type: 'detect'
  frame: ImageBitmap
}

interface ResetRoiMessage {
  type: 'reset-roi'
}

type InMessage = InitMessage | DetectMessage | ResetRoiMessage

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data

  // ── Initialise MediaPipe ──────────────────────────────
  if (msg.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(msg.wasmPath)
      detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: msg.modelPath,
          delegate: 'CPU' // no WebGL in workers — CPU is fine at low res
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5
      })
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({ type: 'error', message: (err as Error).message })
    }
    return
  }

  // ── Reset ROI (e.g. when tracking restarts) ───────────
  if (msg.type === 'reset-roi') {
    lastBox = null
    roiMisses = 0
    return
  }

  // ── Detect faces ──────────────────────────────────────
  if (msg.type === 'detect' && detector) {
    const { frame } = msg
    const fullWidth = frame.width
    const fullHeight = frame.height

    try {
      let detectFrame: ImageBitmap = frame
      let roiOffsetX = 0
      let roiOffsetY = 0
      let usedRoi = false

      // Crop to ROI if we have a previous detection
      if (lastBox) {
        const cx = lastBox.x + lastBox.w / 2
        const cy = lastBox.y + lastBox.h / 2
        const roiW = lastBox.w * ROI_PADDING * 2
        const roiH = lastBox.h * ROI_PADDING * 2

        const x0 = Math.max(0, Math.floor(cx - roiW / 2))
        const y0 = Math.max(0, Math.floor(cy - roiH / 2))
        const w = Math.min(Math.floor(roiW), fullWidth - x0)
        const h = Math.min(Math.floor(roiH), fullHeight - y0)

        if (w > 30 && h > 30) {
          detectFrame = await createImageBitmap(frame, x0, y0, w, h)
          roiOffsetX = x0
          roiOffsetY = y0
          usedRoi = true
        }
      }

      const result = detector.detect(detectFrame)

      // Clean up the cropped bitmap
      if (usedRoi && detectFrame !== frame) {
        detectFrame.close()
      }

      const face = result.detections[0]
      if (face && face.boundingBox) {
        roiMisses = 0
        const box = face.boundingBox

        // Map coordinates back to full-frame space
        const absX = box.originX + roiOffsetX
        const absY = box.originY + roiOffsetY

        lastBox = { x: absX, y: absY, w: box.width, h: box.height }

        self.postMessage({
          type: 'face',
          box: { originX: absX, originY: absY, width: box.width, height: box.height },
          frameWidth: fullWidth,
          frameHeight: fullHeight,
          usedRoi
        })
      } else {
        roiMisses++
        if (usedRoi && roiMisses >= ROI_MISS_LIMIT) {
          // Face left the ROI — switch back to full-frame scan
          lastBox = null
          roiMisses = 0
        }
        self.postMessage({ type: 'no-face' })
      }

      frame.close()
    } catch (err) {
      frame.close()
      console.error('Worker detection error:', err)
      self.postMessage({ type: 'no-face' })
    }
  }
}
