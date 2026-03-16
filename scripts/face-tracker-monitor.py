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

Kleines OpenCV-Fenster mit Kamera-Vorschau, Verbindungsstatus,
Live-Gaze-Daten und Blickrichtungs-Visualisierung.

Tastenbelegung:
    C  - Verbinden / Trennen vom Server
    E  - Eyeball anzeigen auf allen Clients
    H  - Eyeball ausblenden
    +  - FPS erhöhen
    -  - FPS verringern
    Q  - Beenden

Usage:
    uv run scripts/face-tracker-monitor.py
    uv run scripts/face-tracker-monitor.py --server 192.168.1.10
    uv run scripts/face-tracker-monitor.py --camera 1 --fps 10
"""

import argparse
import json
import math
import random
import time

import cv2
import numpy as np
import websocket


# -- Colors (BGR) -----------------------------------------------------------
COL_BG       = (30, 26, 26)       # dark background
COL_GREEN    = (170, 212, 0)      # #00d4aa in BGR
COL_RED      = (107, 107, 255)    # #ff6b6b in BGR
COL_CYAN     = (255, 255, 0)      # cyan
COL_GRAY     = (120, 120, 120)
COL_DARK     = (50, 50, 50)
COL_WHITE    = (230, 230, 230)
COL_YELLOW   = (0, 220, 220)


def poisson_delay(mean_interval: float) -> float:
    u = max(0.001, random.random())
    delay = mean_interval * -math.log(u)
    return max(0.02, min(delay, mean_interval * 3))


def draw_text(img, text, pos, color=COL_WHITE, scale=0.45, thickness=1):
    cv2.putText(img, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def main():
    parser = argparse.ArgumentParser(description="Tessella Face Tracker Monitor")
    parser.add_argument("--server", default="localhost", help="Tessella server IP")
    parser.add_argument("--port", type=int, default=3000, help="Server port")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    parser.add_argument("--fps", type=int, default=8, help="Target FPS")
    parser.add_argument("--width", type=int, default=320, help="Capture width")
    parser.add_argument("--height", type=int, default=240, help="Capture height")
    parser.add_argument("--threshold", type=float, default=0.02, help="Movement threshold")
    args = parser.parse_args()

    # -- Load face detector -------------------------------------------------
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    if face_cascade.empty():
        print(f"FEHLER: Cascade nicht gefunden: {cascade_path}")
        return

    # -- Open camera --------------------------------------------------------
    cap = cv2.VideoCapture(args.camera)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    if not cap.isOpened():
        print(f"FEHLER: Kamera {args.camera} konnte nicht geöffnet werden")
        return

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Kamera geöffnet: {actual_w}x{actual_h}")

    # -- State --------------------------------------------------------------
    ws = None
    connected = False
    client_count = 0
    eyeball_shown = False
    fps = args.fps
    last_sent = {"x": 0.0, "y": 0.0, "z": 0.0}
    current_gaze = {"x": 0.0, "y": 0.0, "z": 0.0}
    face_detected = False

    # ROI state
    roi_box = None
    roi_padding = 1.8
    roi_miss_limit = 5
    roi_misses = 0

    # Display layout: camera (320x240) + side panel (180px)
    PREVIEW_W, PREVIEW_H = 320, 240
    PANEL_W = 180
    WINDOW_W = PREVIEW_W + PANEL_W
    WINDOW_H = PREVIEW_H
    GAZE_VIZ_SIZE = 80  # gaze direction mini-map

    cv2.namedWindow("Tessella Face Tracker", cv2.WINDOW_AUTOSIZE)

    def do_connect():
        nonlocal ws, connected, client_count
        try:
            url = f"ws://{args.server}:{args.port}/?role=pilot"
            ws = websocket.WebSocket()
            ws.settimeout(3)
            ws.connect(url)
            try:
                init_msg = ws.recv()
                data = json.loads(init_msg)
                if data.get("type") == "client-list":
                    client_count = len(data.get("clients", []))
            except Exception:
                pass
            connected = True
            print(f"Verbunden mit {url} ({client_count} Clients)")
        except Exception as e:
            connected = False
            print(f"Verbindungsfehler: {e}")

    def do_disconnect():
        nonlocal ws, connected
        connected = False
        if ws:
            try:
                ws.close()
            except Exception:
                pass
            ws = None
        print("Getrennt")

    def send_msg(msg_dict):
        nonlocal connected
        if not connected or not ws:
            return
        try:
            ws.send(json.dumps(msg_dict))
        except Exception:
            connected = False

    def show_eyeball():
        nonlocal eyeball_shown
        send_msg({"type": "show-eyeball", "target": "all",
                  "irisColor": "#4a7c59", "bgColor": "#0a0a0a"})
        eyeball_shown = True

    def hide_eyeball():
        nonlocal eyeball_shown
        send_msg({"type": "hide-eyeball", "target": "all"})
        eyeball_shown = False

    print("Tasten: [C] Verbinden  [E] Eyeball  [H] Hide  [+/-] FPS  [Q] Beenden")

    # -- Main loop ----------------------------------------------------------
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            # ROI crop
            roi_offset_x, roi_offset_y = 0, 0
            used_roi = False
            detect_gray = gray

            if roi_box is not None:
                rx, ry, rw, rh = roi_box
                cx, cy = rx + rw // 2, ry + rh // 2
                half_w = int(rw * roi_padding)
                half_h = int(rh * roi_padding)
                x0, y0 = max(0, cx - half_w), max(0, cy - half_h)
                x1, y1 = min(actual_w, cx + half_w), min(actual_h, cy + half_h)
                if (x1 - x0) > 30 and (y1 - y0) > 30:
                    detect_gray = gray[y0:y1, x0:x1]
                    roi_offset_x, roi_offset_y = x0, y0
                    used_roi = True

            faces = face_cascade.detectMultiScale(
                detect_gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )

            if len(faces) > 0:
                fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                x = fx + roi_offset_x
                y = fy + roi_offset_y
                w, h = fw, fh

                roi_box = (x, y, w, h)
                roi_misses = 0
                face_detected = True

                center_x = x + w / 2
                center_y = y + h / 2

                norm_x = -((center_x / actual_w) * 2 - 1)
                norm_y = -((center_y / actual_h) * 2 - 1)
                face_size = w * h
                norm_z = max(1.0, 10.0 - (face_size / 2500))

                gaze_x = round(norm_x * 3, 4)
                gaze_y = round(norm_y * 2, 4)
                gaze_z = round(norm_z, 4)
                current_gaze = {"x": gaze_x, "y": gaze_y, "z": gaze_z}

                # Send if moved
                dx = abs(gaze_x - last_sent["x"])
                dy = abs(gaze_y - last_sent["y"])
                dz = abs(gaze_z - last_sent["z"])

                if dx > args.threshold or dy > args.threshold or dz > 0.5:
                    last_sent = {"x": gaze_x, "y": gaze_y, "z": gaze_z}
                    send_msg({
                        "type": "eyeball-gaze", "target": "all",
                        "x": gaze_x, "y": gaze_y, "z": gaze_z,
                    })

                # Draw face rect on preview
                color = COL_CYAN if used_roi else COL_GREEN
                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            else:
                roi_misses += 1
                if roi_misses >= roi_miss_limit:
                    roi_box = None
                    roi_misses = 0
                face_detected = False

            # -- Build display frame ----------------------------------------
            preview = cv2.resize(frame, (PREVIEW_W, PREVIEW_H))
            panel = np.full((WINDOW_H, PANEL_W, 3), COL_BG, dtype=np.uint8)

            # Separator line
            cv2.line(panel, (0, 0), (0, WINDOW_H), COL_DARK, 1)

            # Title
            draw_text(panel, "TESSELLA", (10, 22), COL_GREEN, 0.55, 1)
            draw_text(panel, "FACE TRACKER", (10, 40), COL_GREEN, 0.4, 1)

            # Connection status
            y_off = 65
            if connected:
                cv2.circle(panel, (18, y_off - 4), 5, COL_GREEN, -1)
                draw_text(panel, "Verbunden", (28, y_off), COL_GREEN, 0.38)
                draw_text(panel, f"{client_count} Client(s)", (28, y_off + 16), COL_GRAY, 0.33)
            else:
                cv2.circle(panel, (18, y_off - 4), 5, COL_RED, -1)
                draw_text(panel, "Getrennt", (28, y_off), COL_RED, 0.38)

            # FPS
            y_off = 105
            draw_text(panel, f"FPS: {fps}", (10, y_off), COL_WHITE, 0.38)

            # Face detection status
            y_off = 130
            if face_detected:
                cv2.circle(panel, (18, y_off - 4), 5, COL_GREEN, -1)
                draw_text(panel, "Gesicht", (28, y_off), COL_GREEN, 0.38)
                mode_text = "ROI" if used_roi else "FULL"
                mode_col = COL_CYAN if used_roi else COL_GRAY
                draw_text(panel, mode_text, (100, y_off), mode_col, 0.33)
            else:
                cv2.circle(panel, (18, y_off - 4), 5, COL_RED, -1)
                draw_text(panel, "Kein Gesicht", (28, y_off), COL_RED, 0.38)

            # Gaze values
            y_off = 155
            gx, gy, gz = current_gaze["x"], current_gaze["y"], current_gaze["z"]
            draw_text(panel, f"X: {gx:+.2f}", (10, y_off), COL_WHITE, 0.35)
            draw_text(panel, f"Y: {gy:+.2f}", (10, y_off + 15), COL_WHITE, 0.35)
            draw_text(panel, f"Z: {gz:.1f}", (10, y_off + 30), COL_WHITE, 0.35)

            # Gaze direction mini-map
            viz_x0 = (PANEL_W - GAZE_VIZ_SIZE) // 2
            viz_y0 = WINDOW_H - GAZE_VIZ_SIZE - 10
            viz_cx = viz_x0 + GAZE_VIZ_SIZE // 2
            viz_cy = viz_y0 + GAZE_VIZ_SIZE // 2

            # Background
            cv2.rectangle(panel, (viz_x0, viz_y0),
                          (viz_x0 + GAZE_VIZ_SIZE, viz_y0 + GAZE_VIZ_SIZE),
                          (20, 13, 13), -1)
            # Crosshair
            cv2.line(panel, (viz_cx, viz_y0), (viz_cx, viz_y0 + GAZE_VIZ_SIZE), COL_DARK, 1)
            cv2.line(panel, (viz_x0, viz_cy), (viz_x0 + GAZE_VIZ_SIZE, viz_cy), COL_DARK, 1)

            if face_detected:
                dot_x = int(viz_cx + (gx / 3.0) * (GAZE_VIZ_SIZE // 2 - 4))
                dot_y = int(viz_cy - (gy / 2.0) * (GAZE_VIZ_SIZE // 2 - 4))
                dot_x = max(viz_x0 + 4, min(viz_x0 + GAZE_VIZ_SIZE - 4, dot_x))
                dot_y = max(viz_y0 + 4, min(viz_y0 + GAZE_VIZ_SIZE - 4, dot_y))
                cv2.circle(panel, (dot_x, dot_y), 5, COL_GREEN, -1)
            else:
                cv2.circle(panel, (viz_cx, viz_cy), 5, COL_DARK, -1)

            # Eyeball status indicator
            if eyeball_shown:
                draw_text(panel, "EYE ON", (viz_x0, viz_y0 - 5), COL_YELLOW, 0.3)

            # Compose final frame
            display = np.hstack([preview, panel])

            # Key hints bar at bottom of preview area
            draw_text(display, "[C]onnect [E]ye [H]ide [+/-]FPS [Q]uit",
                      (5, PREVIEW_H - 8), COL_GRAY, 0.3)

            cv2.imshow("Tessella Face Tracker", display)

            # -- Key handling -----------------------------------------------
            key = cv2.waitKey(1) & 0xFF

            if key == ord("q") or key == 27:  # Q or ESC
                break
            elif key == ord("c"):
                if connected:
                    do_disconnect()
                else:
                    do_connect()
            elif key == ord("e"):
                show_eyeball()
            elif key == ord("h"):
                hide_eyeball()
            elif key == ord("+") or key == ord("="):
                fps = min(30, fps + 1)
                print(f"FPS: {fps}")
            elif key == ord("-") or key == ord("_"):
                fps = max(1, fps - 1)
                print(f"FPS: {fps}")

            # Poisson sleep
            time.sleep(poisson_delay(1.0 / max(1, fps)))

    except KeyboardInterrupt:
        print("\nBeende...")
    finally:
        cap.release()
        if ws:
            try:
                ws.close()
            except Exception:
                pass
        cv2.destroyAllWindows()
        print("Face Tracker Monitor beendet.")


if __name__ == "__main__":
    main()
