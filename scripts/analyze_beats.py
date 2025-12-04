import sys
import json
import numpy as np
import librosa

def analyze_beats(file_path):
    try:
        # Load the audio file
        # sr=None preserves the native sampling rate
        y, sr = librosa.load(file_path, sr=None)

        # Detect beat frames
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)

        # Convert beat frames to timestamps
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)

        # Convert to list of floats for JSON serialization
        # beat_times is a numpy array, so we need to convert it
        beat_times_list = beat_times.tolist()

        # Output JSON array to stdout
        print(json.dumps(beat_times_list))

    except Exception as e:
        # Handle errors gracefully and output JSON error object
        error_output = {"error": str(e)}
        print(json.dumps(error_output))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        error_output = {"error": "Usage: python analyze_beats.py <audio_file_path>"}
        print(json.dumps(error_output))
        sys.exit(1)

    audio_file_path = sys.argv[1]
    analyze_beats(audio_file_path)
