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
    4. Force Standards (Scale, Pad, FPS, SAR, Pixel Format)
    5. Burn Subtitles (drawtext)
    6. Output temporary segment
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
        print(f"Segment {index}: Processing Video={video_path}, Audio={audio_path}", file=sys.stderr)
        
        # stream_loop=-1 makes the video input infinite (looping)
        in_video = ffmpeg.input(video_path, stream_loop=-1)
        in_audio = ffmpeg.input(audio_path)

        # Video Operations
        # 1. Trim video to exactly match audio duration
        # setpts='PTS-STARTPTS' resets timestamps to 0 after trimming
        v = in_video.trim(duration=audio_duration).setpts('PTS-STARTPTS')

        # 2. Standardization (CRITICAL FOR STITCHING)
        # Scale and Pad to target resolution
        v = v.filter('scale', width, height, force_original_aspect_ratio='decrease')
        v = v.filter('pad', width, height, '(ow-iw)/2', '(oh-ih)/2')
        
        # Enforce properties to ensure concat works:
        v = v.filter('setsar', '1')       # Square pixels
        v = v.filter('fps', fps=30)       # Force 30 FPS to prevent freezing
        v = v.filter('format', 'yuv420p') # Force pixel format

        # 3. Subtitles
        if text:
            # Basic subtitle burn-in. Ensure fonts are installed in Docker container.
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
        # IMPORTANT: We use a high bitrate here to preserve quality before final concatenation
        out = ffmpeg.output(
            v, 
            in_audio, 
            output_path, 
            vcodec='libx264', 
            acodec='aac', 
            audio_bitrate='192k',
            video_bitrate='4000k', 
            preset='fast',
            pix_fmt='yuv420p', 
            t=audio_duration, # Explicit output duration constraint
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

    # 2. Determine Resolution (720p Default)
    if args.format == "16:9":
        W, H = 1280, 720
    else:
        W, H = 720, 1280

    # 3. Process Each Segment
    temp_files = []
    
    # We will write an inputs.txt file for the concat demuxer
    # Use absolute paths because the demuxer can be picky
    inputs_txt_path = f"inputs_{os.getpid()}.txt"
    
    try:
        import uuid
        session_id = str(uuid.uuid4())[:8]
        
        print(f"Starting processing of {len(segments)} segments at {W}x{H}...", file=sys.stderr)
        
        for i, section in enumerate(segments):
            temp_path = os.path.abspath(f"temp_seg_{session_id}_{i}.mp4")
            process_segment(section, i, temp_path, W, H)
            temp_files.append(temp_path)

        # 4. Generate Concat Demuxer Input File
        with open(inputs_txt_path, 'w') as f:
            for tf in temp_files:
                # Escape path for ffmpeg concat demuxer format
                # file '/path/to/file.mp4'
                f.write(f"file '{tf}'\n")

        print("Concatenating segments using demuxer...", file=sys.stderr)
        
        # Open the concat demuxer as an input
        # safe=0 is required for absolute paths
        input_args = {'f': 'concat', 'safe': 0}
        concat_input = ffmpeg.input(inputs_txt_path, **input_args)
        
        # 5. Mix Background Music
        if args.audio and os.path.exists(args.audio):
            print(f"Mixing background music: {args.audio}", file=sys.stderr)
            bg_music = ffmpeg.input(args.audio)
            # Volume 0.3
            bg_music = bg_music.filter('volume', 0.3)
            
            # We must decode audio to mix it
            # input audio stream from concat
            main_audio = concat_input.audio
            
            # amix: duration='first' cuts music to match video length
            mixed_audio = ffmpeg.filter([main_audio, bg_music], 'amix', duration='first', dropout_transition=2)
            final_audio = mixed_audio
        else:
            final_audio = concat_input.audio

        # 6. Final Output
        # We can COPY the video stream because all segments are chemically identical 
        # (same resolution, fps, sar, pixel format, codec)
        print(f"Rendering final video to {args.output}...", file=sys.stderr)
        
        out = ffmpeg.output(
            concat_input.video, 
            final_audio, 
            args.output, 
            vcodec='copy', # Stream copy video for speed and no re-encoding!
            acodec='aac', 
            audio_bitrate='192k',
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
        if os.path.exists(inputs_txt_path):
            os.remove(inputs_txt_path)
            
        for f in temp_files:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except:
                    pass

if __name__ == "__main__":
    main()
