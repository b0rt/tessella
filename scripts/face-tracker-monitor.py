#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "opencv-python",
#     "websocket-client",
#     "numpy",
# ]
# ///
"""
Face Tracking Control Monitor für Tessella.

OpenCV-basiertes GUI-Fenster mit Kamera-Vorschau, Verbindungssteuerung
und Live-Gaze-Daten. Keine tkinter-Abhängigkeit.

Usage:
    uv run scripts/face-tracker-monitor.py
    uv run scripts/face-tracker-monitor.py --server 192.168.1.10

Tastenbelegung:
    c - Verbinden / Trennen
    e - Eyeball anzeigen
    h - Eyeball ausblenden
    q - Beenden
"""

import argparse
import json
import math
import random
import threading
import time

import cv2
import numpy as np
import websocket


# ---------------------------------------------------------------------------
# Face tracker logic (runs in background thread)
# ---------------------------------------------------------------------------

class FaceTracker:
    def __init__(self):
        self.cap = None
        self.ws = None
        self.running = False
        self.connected = False

        # Settings
        self.server = "localhost"
        self.port = 3000
        self.camera_index = 0
        self.fps = 8
        self.threshold = 0.02
        self.capture_width = 320
        self.capture_height = 240

        # State
        self.last_sent = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.current_gaze = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.face_detected = False
        self.frame_display = None
        self.face_rect = None  # (x, y, w, h) in frame coords
        self.roi_active = False
        self.client_count = 0
        self.status_text = "Getrennt"

        # ROI state
        self._roi_box = None
        self._roi_padding = 1.8
        self._roi_miss_limit = 5
        self._roi_misses = 0

        # Cascade
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.face_cascade = cv2.CascadeClassifier(cascade_path)

        self._lock = threading.Lock()

    # -- Connection ---------------------------------------------------------

    def connect(self) -> str:
        """Connect to Tessella server. Returns status string."""
        try:
            url = f"ws://{self.server}:{self.port}/?role=pilot"
            self.ws = websocket.WebSocket()
            self.ws.settimeout(5)
            self.ws.connect(url)
            # Read initial client-list
            try:
                init_msg = self.ws.recv()
                data = json.loads(init_msg)
                if data.get("type") == "client-list":
                    self.client_count = len(data.get("clients", []))
            except Exception:
                pass
            self.connected = True
            status = f"Verbunden ({self.client_count} Clients)"
            self.status_text = status
            return status
        except Exception as e:
            self.connected = False
            status = f"Fehler: {e}"
            self.status_text = status
            return status

    def disconnect(self):
        self.connected = False
        self.status_text = "Getrennt"
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None

    # -- Camera -------------------------------------------------------------

    def open_camera(self) -> bool:
        self.cap = cv2.VideoCapture(self.camera_index)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.capture_width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.capture_height)
        return self.cap.isOpened()

    def close_camera(self):
        if self.cap:
            self.cap.release()
            self.cap = None

    # -- Send commands ------------------------------------------------------

    def send_show_eyeball(self, iris_color="#4a7c59", bg_color="#0a0a0a"):
        if not self.connected:
            return
        try:
            self.ws.send(json.dumps({
                "type": "show-eyeball",
                "target": "all",
                "irisColor": iris_color,
                "bgColor": bg_color,
            }))
        except Exception:
            pass

    def send_hide_eyeball(self):
        if not self.connected:
            return
        try:
            self.ws.send(json.dumps({
                "type": "hide-eyeball",
                "target": "all",
            }))
        except Exception:
            pass

    # -- Detection loop -----------------------------------------------------

    def _poisson_delay(self) -> float:
        mean = 1.0 / max(1, self.fps)
        u = max(0.001, random.random())
        delay = mean * -math.log(u)
        return max(0.02, min(delay, mean * 3))

    def run_loop(self):
        """Main detection loop - call from a thread."""
        self.running = True
        actual_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            # ROI crop
            roi_offset_x, roi_offset_y = 0, 0
            used_roi = False
            detect_gray = gray

            if self._roi_box is not None:
                rx, ry, rw, rh = self._roi_box
                cx, cy = rx + rw // 2, ry + rh // 2
                half_w = int(rw * self._roi_padding)
                half_h = int(rh * self._roi_padding)
                x0, y0 = max(0, cx - half_w), max(0, cy - half_h)
                x1, y1 = min(actual_w, cx + half_w), min(actual_h, cy + half_h)
                if (x1 - x0) > 30 and (y1 - y0) > 30:
                    detect_gray = gray[y0:y1, x0:x1]
                    roi_offset_x, roi_offset_y = x0, y0
                    used_roi = True

            faces = self.face_cascade.detectMultiScale(
                detect_gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )

            if len(faces) > 0:
                fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                x = fx + roi_offset_x
                y = fy + roi_offset_y
                w, h = fw, fh

                self._roi_box = (x, y, w, h)
                self._roi_misses = 0

                center_x = x + w / 2
                center_y = y + h / 2

                norm_x = -((center_x / actual_w) * 2 - 1)
                norm_y = -((center_y / actual_h) * 2 - 1)
                face_size = w * h
                norm_z = max(1.0, 10.0 - (face_size / 2500))

                gaze_x = round(norm_x * 3, 4)
                gaze_y = round(norm_y * 2, 4)
                gaze_z = round(norm_z, 4)

                with self._lock:
                    self.face_detected = True
                    self.current_gaze = {"x": gaze_x, "y": gaze_y, "z": gaze_z}
                    self.face_rect = (x, y, w, h)
                    self.roi_active = used_roi

                # Send if moved beyond threshold
                dx = abs(gaze_x - self.last_sent["x"])
                dy = abs(gaze_y - self.last_sent["y"])
                dz = abs(gaze_z - self.last_sent["z"])

                if dx > self.threshold or dy > self.threshold or dz > 0.5:
                    self.last_sent = {"x": gaze_x, "y": gaze_y, "z": gaze_z}
                    if self.connected:
                        try:
                            self.ws.send(json.dumps({
                                "type": "eyeball-gaze",
                                "target": "all",
                                "x": gaze_x,
                                "y": gaze_y,
                                "z": gaze_z,
                            }))
                        except Exception:
                            self.connected = False

                # Draw rectangle on frame for preview
                color = (0, 255, 255) if used_roi else (0, 255, 0)
                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            else:
                self._roi_misses += 1
                if self._roi_misses >= self._roi_miss_limit:
                    self._roi_box = None
                    self._roi_misses = 0
                with self._lock:
                    self.face_detected = False
                    self.face_rect = None
                    self.roi_active = False

            # Store display frame
            frame_small = cv2.resize(frame, (320, 240))
            with self._lock:
                self.frame_display = frame_small.copy()

            time.sleep(self._poisson_delay())

    def stop(self):
        self.running = False


# ---------------------------------------------------------------------------
# OpenCV-based GUI
# ---------------------------------------------------------------------------

def draw_overlay(canvas, tracker):
    """Draw HUD overlay with gaze data and status onto the canvas."""
    h, w = canvas.shape[:2]

    with tracker._lock:
        detected = tracker.face_detected
        gaze = tracker.current_gaze.copy()
        roi = tracker.roi_active

    # Semi-transparent status bar at top
    overlay = canvas.copy()
    cv2.rectangle(overlay, (0, 0), (w, 30), (20, 20, 40), -1)
    cv2.addWeighted(overlay, 0.7, canvas, 0.3, 0, canvas)

    # Title
    cv2.putText(canvas, "TESSELLA FACE TRACKER", (6, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 212, 170), 1)

    # Connection status
    conn_color = (0, 212, 170) if tracker.connected else (107, 107, 255)
    cv2.putText(canvas, tracker.status_text, (200, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, conn_color, 1)

    # Semi-transparent bottom bar
    overlay = canvas.copy()
    cv2.rectangle(overlay, (0, h - 50), (w, h), (20, 20, 40), -1)
    cv2.addWeighted(overlay, 0.7, canvas, 0.3, 0, canvas)

    # Face detection indicator
    dot_color = (0, 212, 170) if detected else (107, 107, 255)
    cv2.circle(canvas, (12, h - 35), 5, dot_color, -1)

    # Gaze data
    if detected:
        gaze_text = f"X={gaze['x']:+.2f}  Y={gaze['y']:+.2f}  Z={gaze['z']:.1f}"
    else:
        gaze_text = "-- / -- / --"
    cv2.putText(canvas, f"Gaze: {gaze_text}", (24, h - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (224, 224, 224), 1)

    # ROI indicator
    roi_text = "ROI" if roi else "FULL"
    roi_color = (0, 212, 170) if roi else (136, 136, 136)
    cv2.putText(canvas, roi_text, (280, h - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, roi_color, 1)

    # Gaze direction mini-visualisation (bottom-right)
    viz_x, viz_y = w - 55, h - 45
    viz_w, viz_h = 45, 35
    cv2.rectangle(canvas, (viz_x, viz_y), (viz_x + viz_w, viz_y + viz_h),
                  (50, 50, 50), 1)
    # Crosshair
    cx, cy = viz_x + viz_w // 2, viz_y + viz_h // 2
    cv2.line(canvas, (cx, viz_y), (cx, viz_y + viz_h), (50, 50, 50), 1)
    cv2.line(canvas, (viz_x, cy), (viz_x + viz_w, cy), (50, 50, 50), 1)

    if detected:
        dot_x = int(cx + (gaze["x"] / 3.0) * (viz_w // 2))
        dot_y = int(cy - (gaze["y"] / 2.0) * (viz_h // 2))
        dot_x = max(viz_x + 3, min(viz_x + viz_w - 3, dot_x))
        dot_y = max(viz_y + 3, min(viz_y + viz_h - 3, dot_y))
        cv2.circle(canvas, (dot_x, dot_y), 3, (0, 212, 170), -1)
    else:
        cv2.circle(canvas, (cx, cy), 3, (80, 80, 80), -1)

    # Key hints
    cv2.putText(canvas, "[c]onnect [e]yeball [h]ide [q]uit", (6, h - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (120, 120, 120), 1)


def main():
    parser = argparse.ArgumentParser(description="Tessella Face Tracker Monitor")
    parser.add_argument("--server", default="localhost", help="Tessella server IP")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    parser.add_argument("--fps", type=int, default=8, help="Target FPS")
    args = parser.parse_args()

    tracker = FaceTracker()
    tracker.server = args.server
    tracker.port = args.port
    tracker.camera_index = args.camera
    tracker.fps = args.fps

    # Open camera
    if not tracker.open_camera():
        print(f"Fehler: Kamera {args.camera} konnte nicht geoeffnet werden.")
        return

    # Start tracking thread
    track_thread = threading.Thread(target=tracker.run_loop, daemon=True)
    track_thread.start()

    window_name = "Tessella Face Tracker"
    cv2.namedWindow(window_name, cv2.WINDOW_AUTOSIZE)

    print("Tessella Face Tracker Monitor gestartet.")
    print("Tasten: [c] Verbinden/Trennen  [e] Eyeball  [h] Eyeball aus  [q] Beenden")

    try:
        while True:
            with tracker._lock:
                frame = tracker.frame_display
            if frame is not None:
                canvas = frame.copy()
            else:
                canvas = np.zeros((240, 320, 3), dtype=np.uint8)

            draw_overlay(canvas, tracker)
            cv2.imshow(window_name, canvas)

            key = cv2.waitKey(50) & 0xFF

            if key == ord("q"):
                break
            elif key == ord("c"):
                if tracker.connected:
                    tracker.disconnect()
                    print("Getrennt.")
                else:
                    status = tracker.connect()
                    print(status)
            elif key == ord("e"):
                tracker.send_show_eyeball()
                print("Eyeball anzeigen gesendet.")
            elif key == ord("h"):
                tracker.send_hide_eyeball()
                print("Eyeball ausblenden gesendet.")
    finally:
        tracker.stop()
        track_thread.join(timeout=2)
        tracker.disconnect()
        tracker.close_camera()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
