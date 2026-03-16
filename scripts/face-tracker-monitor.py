#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "opencv-python",
#     "websocket-client",
#     "Pillow",
# ]
# ///
"""
Face Tracking Control Monitor für Tessella.

Kleines GUI-Fenster mit Kamera-Vorschau, Verbindungssteuerung
und Live-Gaze-Daten.

Usage:
    uv run scripts/face-tracker-monitor.py
    uv run scripts/face-tracker-monitor.py --server 192.168.1.10
"""

import argparse
import json
import math
import random
import threading
import time
import tkinter as tk
from tkinter import ttk

import cv2
from PIL import Image, ImageTk
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
        self.frame_rgb = None
        self.face_rect = None  # (x, y, w, h) in frame coords
        self.roi_active = False
        self.client_count = 0

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
            return "Verbunden"
        except Exception as e:
            self.connected = False
            return f"Fehler: {e}"

    def disconnect(self):
        self.connected = False
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
        """Main detection loop – call from a thread."""
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

            # Store RGB frame for GUI preview
            frame_small = cv2.resize(frame, (320, 240))
            with self._lock:
                self.frame_rgb = cv2.cvtColor(frame_small, cv2.COLOR_BGR2RGB)

            time.sleep(self._poisson_delay())

    def stop(self):
        self.running = False


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

class MonitorApp:
    def __init__(self, tracker: FaceTracker):
        self.tracker = tracker
        self.thread = None

        self.root = tk.Tk()
        self.root.title("Tessella Face Tracker Monitor")
        self.root.resizable(False, False)
        self.root.configure(bg="#1a1a2e")

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TFrame", background="#1a1a2e")
        style.configure("TLabel", background="#1a1a2e", foreground="#e0e0e0",
                         font=("monospace", 10))
        style.configure("Header.TLabel", background="#1a1a2e", foreground="#00d4aa",
                         font=("monospace", 12, "bold"))
        style.configure("TButton", font=("monospace", 10))
        style.configure("TEntry", font=("monospace", 10))

        self._build_ui()
        self._update_loop()

    def _build_ui(self):
        root = self.root
        pad = {"padx": 6, "pady": 3}

        # -- Header
        ttk.Label(root, text="TESSELLA FACE TRACKER", style="Header.TLabel"
                  ).pack(pady=(10, 5))

        # -- Connection frame
        conn_frame = ttk.Frame(root)
        conn_frame.pack(fill="x", **pad)

        ttk.Label(conn_frame, text="Server:").grid(row=0, column=0, sticky="w")
        self.server_var = tk.StringVar(value=self.tracker.server)
        ttk.Entry(conn_frame, textvariable=self.server_var, width=18
                  ).grid(row=0, column=1, padx=2)

        ttk.Label(conn_frame, text="Port:").grid(row=0, column=2, sticky="w", padx=(8, 0))
        self.port_var = tk.StringVar(value=str(self.tracker.port))
        ttk.Entry(conn_frame, textvariable=self.port_var, width=6
                  ).grid(row=0, column=3, padx=2)

        self.conn_btn = ttk.Button(conn_frame, text="Verbinden", command=self._toggle_connect)
        self.conn_btn.grid(row=0, column=4, padx=(8, 0))

        self.conn_status = ttk.Label(conn_frame, text="Getrennt", foreground="#ff6b6b")
        self.conn_status.grid(row=1, column=0, columnspan=5, sticky="w", pady=(2, 0))

        # -- Camera frame
        cam_frame = ttk.Frame(root)
        cam_frame.pack(fill="x", **pad)

        ttk.Label(cam_frame, text="Kamera:").grid(row=0, column=0, sticky="w")
        self.cam_var = tk.StringVar(value=str(self.tracker.camera_index))
        ttk.Entry(cam_frame, textvariable=self.cam_var, width=4
                  ).grid(row=0, column=1, padx=2)

        ttk.Label(cam_frame, text="FPS:").grid(row=0, column=2, sticky="w", padx=(8, 0))
        self.fps_var = tk.StringVar(value=str(self.tracker.fps))
        ttk.Entry(cam_frame, textvariable=self.fps_var, width=4
                  ).grid(row=0, column=3, padx=2)

        self.start_btn = ttk.Button(cam_frame, text="Start Tracking", command=self._toggle_tracking)
        self.start_btn.grid(row=0, column=4, padx=(8, 0))

        # -- Preview canvas
        self.canvas = tk.Canvas(root, width=320, height=240, bg="#000000",
                                highlightthickness=1, highlightbackground="#333")
        self.canvas.pack(**pad)
        self._photo = None

        # -- Gaze data display
        data_frame = ttk.Frame(root)
        data_frame.pack(fill="x", **pad)

        self.face_indicator = tk.Canvas(data_frame, width=14, height=14,
                                         bg="#1a1a2e", highlightthickness=0)
        self.face_indicator.grid(row=0, column=0, padx=(0, 4))
        self._indicator_circle = self.face_indicator.create_oval(2, 2, 12, 12, fill="#555")

        self.gaze_label = ttk.Label(data_frame, text="Gaze: -- / -- / --")
        self.gaze_label.grid(row=0, column=1, sticky="w")

        self.roi_label = ttk.Label(data_frame, text="")
        self.roi_label.grid(row=0, column=2, sticky="e", padx=(12, 0))

        # -- Eyeball controls
        eye_frame = ttk.Frame(root)
        eye_frame.pack(fill="x", **pad)

        ttk.Button(eye_frame, text="Eyeball anzeigen",
                   command=lambda: self.tracker.send_show_eyeball()
                   ).pack(side="left", padx=2)
        ttk.Button(eye_frame, text="Eyeball ausblenden",
                   command=lambda: self.tracker.send_hide_eyeball()
                   ).pack(side="left", padx=2)

        # -- Gaze visualization (small 2D indicator)
        viz_frame = ttk.Frame(root)
        viz_frame.pack(**pad)
        ttk.Label(viz_frame, text="Blickrichtung:").pack(anchor="w")
        self.gaze_canvas = tk.Canvas(viz_frame, width=160, height=120,
                                      bg="#0d0d1a", highlightthickness=1,
                                      highlightbackground="#333")
        self.gaze_canvas.pack()
        # Draw crosshair
        self.gaze_canvas.create_line(80, 0, 80, 120, fill="#333")
        self.gaze_canvas.create_line(0, 60, 160, 60, fill="#333")
        self._gaze_dot = self.gaze_canvas.create_oval(75, 55, 85, 65, fill="#00d4aa")

        # Padding at bottom
        ttk.Label(root, text="").pack(pady=2)

    # -- Actions ------------------------------------------------------------

    def _toggle_connect(self):
        if self.tracker.connected:
            self.tracker.disconnect()
            self.conn_btn.configure(text="Verbinden")
            self.conn_status.configure(text="Getrennt", foreground="#ff6b6b")
        else:
            self.tracker.server = self.server_var.get()
            self.tracker.port = int(self.port_var.get())
            status = self.tracker.connect()
            if self.tracker.connected:
                self.conn_btn.configure(text="Trennen")
                clients = self.tracker.client_count
                self.conn_status.configure(
                    text=f"Verbunden ({clients} Client{'s' if clients != 1 else ''})",
                    foreground="#00d4aa",
                )
            else:
                self.conn_status.configure(text=status, foreground="#ff6b6b")

    def _toggle_tracking(self):
        if self.tracker.running:
            self.tracker.stop()
            if self.thread:
                self.thread.join(timeout=2)
                self.thread = None
            self.tracker.close_camera()
            self.start_btn.configure(text="Start Tracking")
        else:
            self.tracker.camera_index = int(self.cam_var.get())
            self.tracker.fps = int(self.fps_var.get())
            if not self.tracker.open_camera():
                self.conn_status.configure(text="Kamera-Fehler!", foreground="#ff6b6b")
                return
            self.thread = threading.Thread(target=self.tracker.run_loop, daemon=True)
            self.thread.start()
            self.start_btn.configure(text="Stop Tracking")

    # -- GUI update loop ----------------------------------------------------

    def _update_loop(self):
        with self.tracker._lock:
            frame = self.tracker.frame_rgb
            detected = self.tracker.face_detected
            gaze = self.tracker.current_gaze.copy()
            roi = self.tracker.roi_active

        # Update preview
        if frame is not None:
            img = Image.fromarray(frame)
            self._photo = ImageTk.PhotoImage(img)
            self.canvas.create_image(0, 0, anchor="nw", image=self._photo)

        # Face indicator
        color = "#00d4aa" if detected else "#ff6b6b"
        self.face_indicator.itemconfig(self._indicator_circle, fill=color)

        # Gaze label
        if detected:
            self.gaze_label.configure(
                text=f"Gaze: X={gaze['x']:+.2f}  Y={gaze['y']:+.2f}  Z={gaze['z']:.1f}"
            )
        else:
            self.gaze_label.configure(text="Gaze: -- / -- / --")

        # ROI label
        self.roi_label.configure(
            text="ROI" if roi else "FULL",
            foreground="#00d4aa" if roi else "#888",
        )

        # Gaze dot visualization
        if detected:
            # gaze x is roughly -3..3, y is -2..2
            dot_x = 80 + (gaze["x"] / 3.0) * 70
            dot_y = 60 - (gaze["y"] / 2.0) * 50
            dot_x = max(5, min(155, dot_x))
            dot_y = max(5, min(115, dot_y))
            self.gaze_canvas.coords(self._gaze_dot,
                                     dot_x - 5, dot_y - 5, dot_x + 5, dot_y + 5)
            self.gaze_canvas.itemconfig(self._gaze_dot, fill="#00d4aa")
        else:
            self.gaze_canvas.coords(self._gaze_dot, 75, 55, 85, 65)
            self.gaze_canvas.itemconfig(self._gaze_dot, fill="#555")

        self.root.after(50, self._update_loop)  # ~20 Hz GUI refresh

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        self.tracker.stop()
        self.tracker.disconnect()
        self.tracker.close_camera()
        self.root.destroy()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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

    app = MonitorApp(tracker)
    app.run()


if __name__ == "__main__":
    main()
