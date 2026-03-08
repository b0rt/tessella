#!/usr/bin/env python3
"""
Lightweight face tracker for Tessella.

Runs on a separate device (e.g. Raspberry Pi) with a camera,
detects faces using OpenCV, and sends gaze data to the Tessella
server over WebSocket.

Requirements:
    pip install opencv-python websocket-client

Usage:
    python face-tracker.py                          # defaults: localhost:3000, camera 0
    python face-tracker.py --server 192.168.1.10    # specify server IP
    python face-tracker.py --camera 1 --fps 5       # camera index & target FPS
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

    print(f"Tracking at ~{args.fps} FPS (Poisson). Press Ctrl+C to stop.")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue

            # Convert to grayscale for detection
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(30, 30),
            )

            if len(faces) > 0:
                # Use the largest face
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])

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
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

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
