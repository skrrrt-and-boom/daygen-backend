#!/usr/bin/env python3
import json
import argparse
import sys
import os
import ffmpeg

def get_audio_duration(path):
    """Get the duration of an audio file using ffprobe."""
    try:
        probe = ffmpeg.probe(path)
        return float(probe['format']['duration'])
    except ffmpeg.Error as e:
        print(f"Error probing {path}: {e.stderr.decode() if hasattr(e, 'stderr') else str(e)}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"Error probing {path}: {e}", file=sys.stderr)
        raise

def process_segment(segment, index, output_path, width, height):
    """
    Process a single segment:
    1. Get Video and Audio (Voiceover)
    2. Loop Video to be at least as long as Audio
    3. Trim Video to match Audio duration
    4. Burn Subtitles (drawtext)
    5. Output temporary segment
    """
    video_path = segment.get('video')
    audio_path = segment.get('audio')
    text = segment.get('text', '')

    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    try:
        # Audio-First Conforming: master duration comes from audio
        audio_duration = get_audio_duration(audio_path)

        # Inputs
        # stream_loop=-1 makes the video input infinite (looping)
        in_video = ffmpeg.input(video_path, stream_loop=-1)
        in_audio = ffmpeg.input(audio_path)

        # Video Operations
        # 1. Trim video to exactly match audio duration
        # Note: We loop first, then trim.
        v = in_video.trim(duration=audio_duration).setpts('PTS-STARTPTS')

        # 2. Scale and Pad to target resolution (Contain mode / Black bars)
        # force_original_aspect_ratio='decrease' ensures it fits inside output box
        v = v.filter('scale', width, height, force_original_aspect_ratio='decrease')
        # pad to fill the rest with black
        v = v.filter('pad', width, height, '(ow-iw)/2', '(oh-ih)/2')
        # set sar to 1 to avoid aspect ratio issues during concat
        v = v.filter('setsar', '1')

        # 3. Subtitles
        # Settings: Bottom center, white text, black border (fontsize 48, Arial or similar)
        # Position: x centered, y at bottom with some margin (100px)
        if text:
            # We assume 'Arial' is available. 
            # If text contains special chars, we rely on python string passing to ffmpeg-python 
            # and ffmpeg-python to handle simple escaping. 
            # Ideally, proper escaping for the complex filter string is needed, 
            # but basic text usually works.
            v = v.drawtext(
                text=text,
                font='Arial',
                fontsize=48,
                fontcolor='white',
                borderw=2,
                bordercolor='black',
                x='(w-text_w)/2',
                y='h-th-100'
            )

        # Output temporary segment
        # Ensure compatible codecs for concatenation later
        out = ffmpeg.output(
            v, 
            in_audio, 
            output_path, 
            vcodec='libx264', 
            acodec='aac', 
            pix_fmt='yuv420p', 
            t=audio_duration, # Explicit duration for safety
            loglevel='error'
        )
        out.run(overwrite_output=True)
        
    except ffmpeg.Error as e:
        print(f"FFmpeg Error in segment {index}:", file=sys.stderr)
        if e.stderr:
            print(e.stderr.decode(), file=sys.stderr)
        raise

def main():
    parser = argparse.ArgumentParser(description="Smart Video Stitcher")
    parser.add_argument("--clips", required=True, help="Path to JSON file with segments")
    parser.add_argument("--output", required=True, help="Final output MP4 file path")
    parser.add_argument("--audio", help="Path to background music")
    parser.add_argument("--format", default="9:16", choices=["9:16", "16:9"], help="Target aspect ratio")
    args = parser.parse_args()

    # 1. Parse JSON Input
    try:
        with open(args.clips, 'r') as f:
            segments = json.load(f)
    except Exception as e:
        print(f"Error loading clips JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if not segments:
        print("No segments provided.", file=sys.stderr)
        sys.exit(1)

    # 2. Determine Resolution
    if args.format == "16:9":
        W, H = 1920, 1080
    else:
        W, H = 1080, 1920

    # 3. Process Each Segment
    temp_files = []
    try:
        import uuid
        session_id = str(uuid.uuid4())[:8] # unique ID for temp files to avoid collisions if running concurrently
        
        print(f"Starting processing of {len(segments)} segments...", file=sys.stderr)
        
        for i, section in enumerate(segments):
            temp_path = f"temp_seg_{session_id}_{i}.mp4"
            # print(f"Processing segment {i+1} -> {temp_path}", file=sys.stderr)
            process_segment(section, i, temp_path, W, H)
            temp_files.append(temp_path)

        # 4. Concatenate Segments
        print("Concatenating segments...", file=sys.stderr)
        if len(temp_files) == 1:
            # If only one file, avoiding concat filter might be safer/faster but concat is fine
            joined_v = ffmpeg.input(temp_files[0]).video
            joined_a = ffmpeg.input(temp_files[0]).audio
        else:
            inputs = [ffmpeg.input(f) for f in temp_files]
            # concat(v=1, a=1)
            joined = ffmpeg.concat(*inputs, v=1, a=1).node
            joined_v = joined[0]
            joined_a = joined[1]

        # 5. Mix Background Music
        if args.audio and os.path.exists(args.audio):
            print(f"Mixing background music: {args.audio}", file=sys.stderr)
            bg_music = ffmpeg.input(args.audio)
            # Volume 0.3
            bg_music = bg_music.filter('volume', 0.3)
            
            # Use amix to mix voiceover (joined_a) and background (bg_music)
            # duration='first' ensures the output length matches the video/voiceover track
            # weights not strictly supported in basic amix without complex filter, but volume filter processes it before.
            mixed_audio = ffmpeg.filter([joined_a, bg_music], 'amix', duration='first', dropout_transition=2)
            final_audio = mixed_audio
        else:
            final_audio = joined_a

        # 6. Final Output
        print(f"Rendering final video to {args.output}...", file=sys.stderr)
        out = ffmpeg.output(
            joined_v, 
            final_audio, 
            args.output, 
            vcodec='libx264', 
            acodec='aac', 
            pix_fmt='yuv420p',
            loglevel='error'
        )
        out.run(overwrite_output=True)
        
        # Success output (stdout)
        print(args.output)

    except Exception as e:
        print(f"Process failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        # Cleanup temp files
        for f in temp_files:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except:
                    pass

if __name__ == "__main__":
    main()
