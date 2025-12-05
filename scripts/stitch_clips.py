#!/usr/bin/env python3
import json
import argparse
import sys
import os
import ffmpeg

def parse_args():
    parser = argparse.ArgumentParser(description="Stitch multiple video clips into a single master video.")
    parser.add_argument("--clips", required=True, help="JSON string or file path containing list of video file paths/URLs")
    parser.add_argument("--output", required=True, help="Output file path")
    parser.add_argument("--audio", help="Optional path to background music")
    parser.add_argument("--format", choices=["9:16", "16:9"], default="9:16", help="Target aspect ratio (default: 9:16)")
    return parser.parse_args()

def get_resolution(aspect_ratio):
    if aspect_ratio == "16:9":
        return 1920, 1080
    else:  # 9:16
        return 1080, 1920

def process_clip(input_path, width, height):
    """
    Scales and pads a video clip to fit within the target resolution (width x height)
    while maintaining aspect ratio. Adds black bars if necessary.
    """
    try:
        container = ffmpeg.input(input_path)
        # Probe video to get metadata (optional, but good for validation if needed)
        # probe = ffmpeg.probe(input_path)
        
        # Scale to fit in the box while preserving aspect ratio
        # force_original_aspect_ratio='decrease' ensures it fits inside
        video = container.video.filter('scale', width, height, force_original_aspect_ratio='decrease')
        
        # Pad to fill the remaining space
        # x=(ow-iw)/2:y=(oh-ih)/2 centers the video
        video = video.filter('pad', width, height, '(ow-iw)/2', '(oh-ih)/2')
        
        # Force SAR to 1/1 to match master
        video = video.filter('setsar', '1')
        
        # Get audio stream, or generate silent audio if missing? 
        # For simplicity, we assume clips have audio. If not, we might need a more complex check.
        # But `ffmpeg-python` concat handles missing audio streams if we are careful, 
        # usually simpler to just take the audio stream if it exists.
        # Checking for audio stream existence is safer.
        has_audio = False
        try:
           probe = ffmpeg.probe(input_path)
           for stream in probe['streams']:
               if stream['codec_type'] == 'audio':
                   has_audio = True
                   break
        except ffmpeg.Error as e:
            print(f"Error probing {input_path}: {e.stderr.decode()}", file=sys.stderr)
            # Proceed assuming no audio or broken file, ffmpeg might fail later
            pass

        audio = container.audio if has_audio else ffmpeg.input('anullsrc', f='lavfi', t=0.1).audio # Placeholder, might be tricky with concat
        # Actually, for concat filter in ffmpeg-python, it's best to have consistent streams.
        # If a clip has no audio, we should generate silent audio of the same duration.
        # However, that requires knowing the duration.
        # Let's start simple: assume clips have audio or accept that silent clips might drop audio in the final mix if not handled.
        # Enhanced approach: Use a `concat` input of streams.
        
        if not has_audio:
             # Create silent audio for the duration of the video
            # Getting duration requires check
            video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
            duration = float(video_info.get('duration', 0))
            if duration == 0:
                 # fallback to tags or container duration
                 duration = float(probe['format']['duration'])
            
            # generated silence
            audio = ffmpeg.input(f'anullsrc=d={duration}', f='lavfi').audio

        return video, audio
    except Exception as e:
        print(f"Error preparing clip {input_path}: {e}", file=sys.stderr)
        raise e

def main():
    args = parse_args()

    # Parse clips argument
    try:
        if os.path.isfile(args.clips):
            with open(args.clips, 'r') as f:
                clips_list = json.load(f)
        else:
            clips_list = json.loads(args.clips)
    except json.JSONDecodeError as e:
        print(f"Error parsing clips JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if not clips_list:
        print("No clips provided.", file=sys.stderr)
        sys.exit(1)

    width, height = get_resolution(args.format)
    
    processed_streams = []
    
    for clip_path in clips_list:
        v, a = process_clip(clip_path, width, height)
        processed_streams.append(v)
        processed_streams.append(a)

    # Concatenate all clips
    # v=1, a=1 means 1 video stream and 1 audio stream output
    joined = ffmpeg.concat(*processed_streams, v=1, a=1).node
    v_joined = joined[0]
    a_joined = joined[1]

    # Handle Background Music
    if args.audio:
        bg_music = ffmpeg.input(args.audio)
        # We want the background music to play along with the clips audio.
        # We can use amix.
        # First, we might want to trim or loop the bg music?
        # Requirement: "mix it in".
        # Simplest mix: amix input 1 (clips audio) and input 2 (bg music).
        # We should ensure bg music is not shorter than video? Or just let it end?
        # Usually for these pipelines, looping or just playing it is fine. 
        # Let's just mix. If bg is shorter, it stops. If longer, it continues? 
        # ffmpeg amix duration default is 'longest', shortest, or first. 'first' is usually good to match video length if video is first.
        
        # Let's set duration='first' so it ends when the concatenated video ends.
        a_final = ffmpeg.filter([a_joined, bg_music], 'amix', duration='first')
    else:
        a_final = a_joined

    # Output
    try:
        out = ffmpeg.output(v_joined, a_final, args.output, vcodec='libx264', acodec='aac', pix_fmt='yuv420p', shortest=None)
        out.run(overwrite_output=True, capture_stdout=True, capture_stderr=True)
        print(args.output)
    except ffmpeg.Error as e:
        print("FFmpeg error:", file=sys.stderr)
        print(e.stderr.decode(), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
