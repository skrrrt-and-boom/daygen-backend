import os
import subprocess
import json
import sys

def create_dummy_assets():
    # Create dummy video (2 seconds, black)
    subprocess.run([
        'ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:d=2',
        '-c:v', 'libx264', 'dummy_video.mp4'
    ], check=True, stderr=subprocess.DEVNULL)

    # Create dummy audio (2 seconds, sine wave)
    subprocess.run([
        'ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2',
        '-c:a', 'aac', 'dummy_audio.mp4'
    ], check=True, stderr=subprocess.DEVNULL)

def test_stitch():
    create_dummy_assets()
    
    manifest = [{
        "video": os.path.abspath("dummy_video.mp4"),
        "audio": os.path.abspath("dummy_audio.mp4"),
        "text": "Hello World Test"
    }]
    
    with open("test_manifest.json", "w") as f:
        json.dump(manifest, f)
        
    cmd = [
        sys.executable, 
        "scripts/stitch_clips.py",
        "--clips", "test_manifest.json",
        "--output", "final_test_output.mp4",
        "--format", "9:16",
        "--fontsize", "90",
        "--color", "yellow"
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print("Stitching failed!")
        print(result.stderr)
        sys.exit(1)
    else:
        print("Stitching succeeded!")
        print("Output:", result.stdout)

    # Cleanup
    for f in ["dummy_video.mp4", "dummy_audio.mp4", "test_manifest.json", "final_test_output.mp4"]:
        if os.path.exists(f):
            os.remove(f)

if __name__ == "__main__":
    test_stitch()
