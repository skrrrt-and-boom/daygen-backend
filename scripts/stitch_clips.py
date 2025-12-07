#!/usr/bin/env python3
import json
import argparse
import sys
import os
import re
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

def process_segment(segment, index, output_path, width, height, font_settings):
    """
    Process a single segment:
    1. Get Video and Audio (Voiceover)
    2. Loop Video to be at least as long as Audio
    3. Trim Video to match Audio duration
    4. Force Standards (Scale, Pad, FPS, SAR, Pixel Format)
    5. Burn Subtitles (One word at a time)
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
        print(f"Segment {index}: Processing Video={video_path}, Audio={audio_path}, Text='{text}'", file=sys.stderr)
        
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

        # 3. Subtitles (One Word at a Time)
        if text:
            # CLEANUP: Remove [instructions] and extra spaces
            # Also remove hyphens as requested "-" and "--"
            clean_text = re.sub(r'\[.*?\]', '', text)
            clean_text = clean_text.replace('--', ' ').replace('-', ' ') 
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            
            alignment = segment.get('alignment')
            
            if alignment:
                # PRECISION ALIGNMENT using ElevenLabs timestamps
                chars = alignment.get('characters', [])
                starts = alignment.get('character_start_times_seconds', [])
                ends = alignment.get('character_end_times_seconds', [])
                
                # Reconstruct words from characters
                # We need to group characters into words and find their start of first char and end of last char
                current_word = ""
                word_start = -1
                word_end = -1
                
                words_with_timing = []
                
                for i, char in enumerate(chars):
                    # Skip characters inside brackets []
                    if char == '[':
                        continue
                    if char == ']':
                        continue
                        
                    # Also we should probably track open/close brackets to be safe, 
                    # but typically alignment chars are just flattened text.
                    # If the alignment chars include the brackets, we just skip them.
                    # HOWEVER, if the alignment characters are literally the characters of the text passed to ElevenLabs,
                    # and that text had [instructions], then we need to ignore everything between [ and ].
                    
                    # Let's check if we are inside a bracket block
                    # But `chars` is a list of characters. We need state.
                    pass 

                # Re-do the loop with state
                in_bracket = False
                
                for i, char in enumerate(chars):
                    if char == '[':
                        in_bracket = True
                        continue
                    if char == ']':
                        in_bracket = False
                        continue
                    
                    if in_bracket:
                        continue

                    if char == ' ':
                        if current_word:
                            # Finish word
                            display_word = current_word.replace('--', '').replace('-', '')
                            if display_word.strip():
                                words_with_timing.append({
                                    'text': display_word,
                                    'start': word_start,
                                    'end': word_end
                                })
                            current_word = ""
                            word_start = -1
                            word_end = -1
                    else:
                        if word_start == -1:
                            word_start = starts[i]
                        word_end = ends[i]
                        current_word += char
                
                # Add last word
                if current_word:
                    display_word = current_word.replace('--', '').replace('-', '')
                    if display_word.strip():
                        words_with_timing.append({
                            'text': display_word,
                            'start': word_start,
                            'end': word_end
                        })
                        
                # Draw words with precise timing
                font_path = font_settings.get('font')
                font_arg = font_path if font_path and os.path.exists(font_path) else 'Arial'

                for w in words_with_timing:
                    safe_word = w['text'].replace("'", "\\'").replace(":", "\\:")
                    v = v.drawtext(
                        text=safe_word,
                        fontfile=font_arg if os.path.exists(font_arg) else None,
                        font=font_arg if not os.path.exists(font_arg) else None,
                        fontsize=font_settings.get('fontsize', 70),
                        fontcolor=font_settings.get('color', 'yellow'),
                        borderw=2,
                        bordercolor='black',
                        shadowcolor='black',
                        shadowx=2,
                        shadowy=2,
                        x='(w-text_w)/2',
                        y=font_settings.get('y_pos', '(h-text_h)/1.2'),
                        enable=f'between(t,{w["start"]},{w["end"]})'
                    )

            else:
                # FALLBACK: Even distribution
                words = clean_text.split()
                if words:
                    word_duration = audio_duration / len(words)
                    
                    font_path = font_settings.get('font')
                    font_arg = font_path if font_path and os.path.exists(font_path) else 'Arial'

                    for i, word in enumerate(words):
                        start_time = i * word_duration
                        end_time = (i + 1) * word_duration
                        
                        if i == len(words) - 1:
                            end_time = audio_duration

                        safe_word = word.replace("'", "\\'").replace(":", "\\:")
                        
                        v = v.drawtext(
                            text=safe_word,
                            fontfile=font_arg if os.path.exists(font_arg) else None,
                            font=font_arg if not os.path.exists(font_arg) else None,
                            fontsize=font_settings.get('fontsize', 70),
                            fontcolor=font_settings.get('color', 'yellow'),
                            borderw=2,
                            bordercolor='black',
                            shadowcolor='black',
                            shadowx=2,
                            shadowy=2,
                            x='(w-text_w)/2',
                            y=font_settings.get('y_pos', '(h-text_h)/1.2'),
                            enable=f'between(t,{start_time},{end_time})'
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
    
    # Text Styling Arguments
    parser.add_argument("--font", default="Arial", help="Path to font file or font name")
    parser.add_argument("--fontsize", type=int, default=80, help="Font size")
    parser.add_argument("--color", default="white", help="Font color (ffmpeg name or hex)")
    parser.add_argument("--y_pos", default="(h-text_h)/1.15", help="Y position expression for text") # Default: slightly up from bottom
    parser.add_argument("--volume", type=float, default=0.3, help="Background music volume (0.0 to 1.0)")
    parser.add_argument("--temp_dir", required=False, help="Directory for temporary files")


    args = parser.parse_args()

    # Bundle font path resolution
    base_dir = os.path.dirname(os.path.abspath(__file__))
    bundled_font = os.path.join(base_dir, '..', 'assets', 'fonts', 'Roboto-Regular.ttf')
    
    default_font = "Arial"
    if os.path.exists(bundled_font):
        default_font = bundled_font
        
    font_arg = args.font
    if font_arg == "Arial" and os.path.exists(bundled_font):
         # If user didn't override default (or explicitly said Arial), prefer bundled
         font_arg = bundled_font

    font_settings = {
        'font': font_arg,
        'fontsize': args.fontsize,
        'color': args.color,
        'y_pos': args.y_pos
    }

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
        W, H = 1920, 1080 # Upgrade to 1080p for premium feel? Or stick to 720p? User said "premium reels". Let's stick to 720p for speed or 1080p?
        # The prompt didn't strictly say 1080p, but "Video look like debug...". 
        # Changing resolution might be risky if assets are small, but let's stick to the previous code's logic for W/H but maybe confirm resolution.
        # Previous code: 16:9 -> 1280x720. 9:16 -> 720x1280.
        # Let's keep it safe for now to avoid OOM or slow processing, improvement comes from fonts.
        W, H = 1280, 720
    else:
        W, H = 720, 1280

    # 3. Process Each Segment
    temp_files = []
    
    # Use provided temp_dir or current directory
    work_dir = args.temp_dir if args.temp_dir else os.getcwd()
    if not os.path.exists(work_dir):
        os.makedirs(work_dir, exist_ok=True)

    # We will write an inputs.txt file for the concat demuxer
    # Use absolute paths because the demuxer can be picky
    inputs_txt_path = os.path.join(work_dir, f"inputs_{os.getpid()}.txt")
    
    try:
        import uuid
        session_id = str(uuid.uuid4())[:8]
        
        print(f"Starting processing of {len(segments)} segments at {W}x{H}...", file=sys.stderr)
        
        for i, section in enumerate(segments):
            temp_path = os.path.join(work_dir, f"temp_seg_{session_id}_{i}.mp4")
            process_segment(section, i, temp_path, W, H, font_settings)
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
            # Volume from args
            bg_music = bg_music.filter('volume', args.volume)
            
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
