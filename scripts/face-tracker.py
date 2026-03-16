#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "opencv-python",
#     "websocket-client",
# ]
# ///
"""
Lightweight face tracker for Tessella.

Runs on a separate device (e.g. Raspberry Pi) with a camera,
detects faces using OpenCV, and sends gaze data to the Tessella
server over WebSocket.

Requirements:
    uv pip install -r scripts/requirements.txt

Usage:
    uv run scripts/face-tracker.py                          # defaults: localhost:3000, camera 0
    uv run scripts/face-tracker.py --server 192.168.1.10    # specify server IP
    uv run scripts/face-tracker.py --camera 1 --fps 5       # camera index & target FPS
"""

import argparse
import json
import math
import random
import time
import threading

import cv2
import websocket


def poisson_delay(mean_interval: float) -> float:
    """Exponentially distributed delay for natural sampling variation."""
    u = max(0.001, random.random())
    delay = mean_interval * -math.log(u)
    return max(0.02, min(delay, mean_interval * 3))


def main():
    parser = argparse.ArgumentParser(description="Tessella face tracker")
    parser.add_argument("--server", default="localhost", help="Tessella server IP/hostname")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--camera", type=int, default=0, help="Camera device index")
    parser.add_argument("--fps", type=int, default=8, help="Target detection FPS")
    parser.add_argument("--width", type=int, default=320, help="Capture width")
    parser.add_argument("--height", type=int, default=240, help="Capture height")
    parser.add_argument("--threshold", type=float, default=0.02, help="Movement threshold to send update")
    parser.add_argument("--preview", action="store_true", help="Show camera preview window")
    args = parser.parse_args()

    # Load OpenCV's built-in face detector (Haar cascade, very lightweight)
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    if face_cascade.empty():
        print(f"ERROR: Could not load face cascade from {cascade_path}")
        return

    # Open camera
    cap = cv2.VideoCapture(args.camera)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    if not cap.isOpened():
        print(f"ERROR: Could not open camera {args.camera}")
        return

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Camera opened: {actual_w}x{actual_h}")

    # Connect to Tessella server as pilot
    ws_url = f"ws://{args.server}:{args.port}/?role=pilot"
    print(f"Connecting to {ws_url} ...")

    ws = websocket.WebSocket()
    ws.connect(ws_url)
    print("Connected to Tessella server as pilot")

    # Read and discard the initial client-list message
    try:
        init_msg = ws.recv()
        data = json.loads(init_msg)
        if data.get("type") == "client-list":
            print(f"Server has {len(data.get('clients', []))} client(s) connected")
    except Exception:
        pass

    mean_interval = 1.0 / args.fps
    last_sent = {"x": 0.0, "y": 0.0, "z": 0.0}

    # ROI tracking state
    roi_box = None        # (x, y, w, h) of last detected face
    roi_padding = 1.8     # expand ROI by this factor on each side
    roi_miss_limit = 5    # fall back to full frame after N misses
    roi_misses = 0

    print(f"Tracking at ~{args.fps} FPS (Poisson + ROI). Press Ctrl+C to stop.")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue

            # Convert to grayscale for detection
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            # ROI: crop around last known face position
            roi_offset_x, roi_offset_y = 0, 0
            used_roi = False
            detect_gray = gray

            if roi_box is not None:
                rx, ry, rw, rh = roi_box
                cx, cy = rx + rw // 2, ry + rh // 2
                half_w = int(rw * roi_padding)
                half_h = int(rh * roi_padding)
                x0 = max(0, cx - half_w)
                y0 = max(0, cy - half_h)
                x1 = min(actual_w, cx + half_w)
                y1 = min(actual_h, cy + half_h)
                if (x1 - x0) > 30 and (y1 - y0) > 30:
                    detect_gray = gray[y0:y1, x0:x1]
                    roi_offset_x, roi_offset_y = x0, y0
                    used_roi = True

            faces = face_cascade.detectMultiScale(
                detect_gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(30, 30),
            )

            if len(faces) > 0:
                # Use the largest face
                fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])

                # Map back to full-frame coordinates
                x = fx + roi_offset_x
                y = fy + roi_offset_y
                w, h = fw, fh

                roi_box = (x, y, w, h)
                roi_misses = 0

                center_x = x + w / 2
                center_y = y + h / 2

                # Normalize to -1..1 (invert X for mirror effect)
                norm_x = -((center_x / actual_w) * 2 - 1)
                norm_y = -((center_y / actual_h) * 2 - 1)

                # Estimate depth from face size
                face_size = w * h
                norm_z = max(1.0, 10.0 - (face_size / 2500))

                gaze_x = norm_x * 3
                gaze_y = norm_y * 2

                # Only send if position changed beyond threshold
                dx = abs(gaze_x - last_sent["x"])
                dy = abs(gaze_y - last_sent["y"])
                dz = abs(norm_z - last_sent["z"])

                if dx > args.threshold or dy > args.threshold or dz > 0.5:
                    last_sent = {"x": gaze_x, "y": gaze_y, "z": norm_z}
                    msg = json.dumps({
                        "type": "eyeball-gaze",
                        "target": "all",
                        "x": round(gaze_x, 4),
                        "y": round(gaze_y, 4),
                        "z": round(norm_z, 4),
                    })
                    ws.send(msg)

                if args.preview:
                    color = (255, 255, 0) if used_roi else (0, 255, 0)
                    cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            else:
                roi_misses += 1
                if roi_misses >= roi_miss_limit:
                    roi_box = None
                    roi_misses = 0

            if args.preview:
                cv2.imshow("Tessella Face Tracker", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            # Poisson-distributed sleep
            time.sleep(poisson_delay(mean_interval))

    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        cap.release()
        ws.close()
        if args.preview:
            cv2.destroyAllWindows()
        print("Face tracker stopped.")


if __name__ == "__main__":
    main()
