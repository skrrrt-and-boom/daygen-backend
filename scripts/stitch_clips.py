#!/usr/bin/env python3
import json
import argparse
import sys
import os
import re
import ffmpeg

def process_segment(segment, index, output_path, width, height, font_settings, include_subtitles=True):
    video_path = segment.get('video')
    audio_path = segment.get('audio')
    text = segment.get('text', '')
    # STRICT DURATION FROM BACKEND (Target aligned to beats)
    target_duration = segment.get('duration') 
    
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    if target_duration is None:
        raise ValueError(f"Segment {index} missing 'duration' field.")

    # Probe Video Duration
    video_duration = 0
    try:
        probe = ffmpeg.probe(video_path)
        # Try to get video stream duration
        video_stream_info = next((s for s in probe['streams'] if s['codec_type'] == 'video'), None)
        if video_stream_info and 'duration' in video_stream_info:
            video_duration = float(video_stream_info['duration'])
        # Fallback to container duration
        elif 'format' in probe and 'duration' in probe['format']:
             video_duration = float(probe['format']['duration'])
    except Exception as e:
        print(f"Warning: Could not probe video {video_path}: {e}", file=sys.stderr)

    # Probe Audio Duration for time-stretching
    input_audio_duration = 0
    try:
        a_probe = ffmpeg.probe(audio_path)
        a_stream_info = next((s for s in a_probe['streams'] if s['codec_type'] == 'audio'), None)
        if a_stream_info and 'duration' in a_stream_info:
            input_audio_duration = float(a_stream_info['duration'])
        elif 'format' in a_probe and 'duration' in a_probe['format']:
             input_audio_duration = float(a_probe['format']['duration'])
    except Exception as e:
        print(f"Warning: Could not probe audio {audio_path}: {e}", file=sys.stderr)


    # STRICT MODE: Respect the duration passed from backend
    final_duration = target_duration

    try:
        print(f"Segment {index}: InAudio={input_audio_duration}s | Target={target_duration}s | VideoDur={video_duration}s", file=sys.stderr)
        
        # Smart Stitching Logic
        # Calculate audio/video ratio to decide strategy
        # Video ratio: If we want video to fit target.
        # We already handle video stretching below based on `target_duration` vs `video_duration`.
        video_ratio = target_duration / video_duration if video_duration > 0 else 1.0
        print(f"Segment {index}: Ratio Video: {video_ratio:.2f}", file=sys.stderr)

        # 1. VIDEO PIPELINE
        in_video = ffmpeg.input(video_path)

        if video_duration >= target_duration:
            # Case 1: Video is long enough. Just trim.
            # Loop just in case of slight precision errors, then trim.
            v = in_video.filter('trim', duration=final_duration).filter('setpts', 'PTS-STARTPTS')
        
        else:
            # Video is shorter. Smart Loop.
            # Use video_ratio. Atempo logic for video is `setpts`. 
            # setpts= (1/ratio) * PTS to speed up? No.
            # video_ratio = target / source. 
            # If target (4s) > source (2s), ratio = 2.0. We need to SLOW DOWN.
            # setpts=2.0*PTS makes it 2x longer. Correct.
            if video_ratio <= 1.5:
                 # Case 2: Small gap (>1.0, <=1.5). Slow down video.
                 # Force duration match by changing PTS
                 print(f"Segment {index}: Apply SLOW DOWN (Ratio {video_ratio:.2f})", file=sys.stderr)
                 # setpts=RATIO*PTS slows it down
                 v = in_video.filter('setpts', f"{video_ratio}*PTS")
                 # Ensure exact trim
                 v = v.filter('trim', duration=final_duration)
            else:
                 # Case 3: Large gap (>1.5). Ping-Pong Loop.
                 print(f"Segment {index}: Apply PING-PONG LOOP (Ratio {video_ratio:.2f})", file=sys.stderr)
                 
                 # Create Reverse
                 # [0] split [v_fwd] [v_rev_pre]
                 split = in_video.split()
                 v_fwd = split[0]
                 v_rev = split[1].filter('reverse')
                 
                 # Concat Forward + Reverse
                 # [v_fwd][v_rev] concat=n=2:v=1:a=0
                 ping_pong = ffmpeg.concat(v_fwd, v_rev, v=1, a=0)
                 
                 # Loop this specific ping-pong sequence indefinitely
                 # Then trim to final duration
                 v = ping_pong.filter('loop', loop=-1, size=32767, start=0)
                 v = v.filter('trim', duration=final_duration).filter('setpts', 'PTS-STARTPTS')

        # Common Cleanup: Scale/Pad/Format
        v = v.filter('scale', width, height, force_original_aspect_ratio='decrease')
        v = v.filter('pad', width, height, '(ow-iw)/2', '(oh-ih)/2')
        v = v.filter('setsar', '1')
        v = v.filter('fps', fps=30)
        v = v.filter('format', 'yuv420p')

        # 2. AUDIO PIPELINE
        # Time-stretching logic
        in_audio = ffmpeg.input(audio_path)
        a = in_audio

        if input_audio_duration > 0 and target_duration > 0:
            # Check if we need to stretch
            # Tolerance: 0.1s
            if abs(input_audio_duration - target_duration) > 0.1:
                tempo = input_audio_duration / target_duration
                print(f"Segment {index}: Audio Time-Stretch required. Input={input_audio_duration}, Target={target_duration}, Tempo={tempo:.2f}", file=sys.stderr)
                
                # Constraint: 0.5 <= tempo <= 2.0
                # If outside, we chain.
                # Simple chaining:
                while tempo > 2.0:
                    a = a.filter('atempo', '2.0')
                    tempo /= 2.0
                while tempo < 0.5:
                    a = a.filter('atempo', '0.5')
                    tempo /= 0.5
                
                # Apply remaining
                a = a.filter('atempo', str(tempo))

        # Pad/Trim to exact final duration to be safe
        a = a.filter('apad').filter('atrim', duration=final_duration)

        # 3. SUBTITLES (Existing Logic Preserved)
        # 3. SUBTITLES (Existing Logic Preserved)
        if text and include_subtitles:
            clean_text = re.sub(r'\[.*?\]', '', text).replace('--', ' ').replace('-', ' ')
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            alignment = segment.get('alignment')

            # Calculate Subtitle Scale Factor (match Audio Pipeline logic)
            subtitle_scale = 1.0
            if input_audio_duration > 0 and target_duration > 0:
                 if abs(input_audio_duration - target_duration) > 0.1:
                      subtitle_scale = target_duration / input_audio_duration
                      print(f"Segment {index}: Scaling Subtitles by {subtitle_scale:.4f} (Input={input_audio_duration} -> Target={target_duration})", file=sys.stderr)
            
            font_path = font_settings.get('font')
            # Fallback if font missing
            if not os.path.exists(font_path) and font_path != 'Arial':
                 font_path = 'Arial'

            base_drawtext = {
                'fontsize': font_settings.get('fontsize', 70),
                'fontcolor': font_settings.get('color', 'yellow'),
                'borderw': 2,
                'bordercolor': 'black',
                'shadowcolor': 'black',
                'shadowx': 2,
                'shadowy': 2,
                'box': 1,
                'boxcolor': 'black@0.6',
                'boxborderw': 10,
                'x': '(w-text_w)/2',
                'y': font_settings.get('y_pos', '(h-text_h)/1.2'),
            }
            
            if os.path.exists(font_path):
                base_drawtext['fontfile'] = font_path
            else:
                base_drawtext['font'] = font_path

            if alignment:
                # Precise alignment logic
                chars = alignment.get('characters', [])
                starts = alignment.get('character_start_times_seconds', [])
                ends = alignment.get('character_end_times_seconds', [])
                
                # Simple word aggregator
                current_word = ""
                w_start = -1
                w_end = -1
                
                for i, char in enumerate(chars):
                    if char in ['[', ']']: continue # rudimentary skip
                    
                    if char == ' ':
                        if current_word.strip():
                            safe_word = current_word.strip().replace("'", "\\'").replace(":", "\\:")
                            dt = base_drawtext.copy()
                            dt['text'] = safe_word
                            # Apply Scaling
                            dt['enable'] = f'between(t,{w_start},{w_end})'
                            v = v.drawtext(**dt)
                        current_word = ""
                        w_start = -1
                    else:
                        if w_start == -1: 
                            w_start = starts[i] * subtitle_scale
                        w_end = ends[i] * subtitle_scale
                        current_word += char
                
                # Last word
                if current_word.strip():
                    safe_word = current_word.strip().replace("'", "\\'").replace(":", "\\:")
                    dt = base_drawtext.copy()
                    dt['text'] = safe_word
                    dt['enable'] = f'between(t,{w_start},{w_end})'
                    v = v.drawtext(**dt)
            else:
                # Even distribution fallback
                words = clean_text.split()
                if words:
                    # Duration for text distribution should match audio length, NOT video padding
                    # But we don't have raw audio length easily here without probing. 
                    # Approximation: Use target_duration * 0.9 to avoid text in silence?
                    # Better: Probe audio file in Python before this. 
                    # For now, spread across 90% of duration to be safe.
                    w_dur = (target_duration * 0.9) / len(words)
                    for i, word in enumerate(words):
                        safe_word = word.replace("'", "\\'").replace(":", "\\:")
                        dt = base_drawtext.copy()
                        dt['text'] = safe_word
                        dt['enable'] = f'between(t,{i*w_dur},{(i+1)*w_dur})'
                        v = v.drawtext(**dt)

        # 4. OUTPUT
        out = ffmpeg.output(
            v, a, output_path,
            vcodec='libx264', acodec='aac',
            audio_bitrate='192k', video_bitrate='4000k',
            preset='fast', pix_fmt='yuv420p',
            t=final_duration, # Redundant but safe
            loglevel='error'
        )
        out.run(overwrite_output=True)

    except Exception as e:
        print(f"Error processing segment {index}: {e}", file=sys.stderr)
        raise

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--audio", required=False)
    parser.add_argument("--format", default="9:16")
    parser.add_argument("--temp_dir", required=False)
    parser.add_argument("--font", default="Arial")
    parser.add_argument("--fontsize", type=int, default=70)
    parser.add_argument("--color", default="yellow")
    parser.add_argument("--y_pos", default="(h-text_h)/1.2")
    parser.add_argument("--volume", type=float, default=0.3)
    parser.add_argument("--no_subtitles", action="store_true")
    args = parser.parse_args()

    # Resolution
    W, H = (1080, 1920) if args.format == "9:16" else (1920, 1080)

    # Load Segments
    with open(args.clips, 'r') as f:
        segments = json.load(f)

    # Prepare Temp Dir
    work_dir = os.path.abspath(args.temp_dir) if args.temp_dir else os.getcwd()
    os.makedirs(work_dir, exist_ok=True)
    
    font_settings = {
        'font': args.font,
        'fontsize': args.fontsize,
        'color': args.color,
        'y_pos': args.y_pos
    }

    # Process Segments
    temp_files = []
    import uuid
    session_id = str(uuid.uuid4())[:8]

    print(f"Stitching {len(segments)} segments...", file=sys.stderr)

    # Process Segments
    # Pre-allocate list to maintain order
    temp_files = [None] * len(segments) 
    
    import concurrent.futures
    # Determine workers: use CPU count but cap at 4 to avoid OOM/Swap death on smaller instances
    # Each worker spawns an ffmpeg process, so 4 workers = 4 ffmpeg processes.
    max_workers = min(os.cpu_count() or 4, 4)
    
    print(f"Stitching {len(segments)} segments in parallel (Workers: {max_workers})...", file=sys.stderr)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_index = {}
        for i, seg in enumerate(segments):
            out_name = os.path.join(work_dir, f"seg_{session_id}_{i}.mp4")
            future = executor.submit(process_segment, seg, i, out_name, W, H, font_settings, not args.no_subtitles)
            future_to_index[future] = (i, out_name)

        for future in concurrent.futures.as_completed(future_to_index):
            i, out_name = future_to_index[future]
            try:
                future.result()
                temp_files[i] = out_name
                print(f"Segment {i} finished.", file=sys.stderr)
            except Exception as exc:
                print(f"Segment {i} generated an exception: {exc}", file=sys.stderr)
                # Cancel remaining?
                raise exc
    
    # Ensure no Nones (should be covered by exception raise above)
    temp_files = [f for f in temp_files if f]

    # Concat
    list_path = os.path.join(work_dir, f"inputs_{session_id}.txt")
    with open(list_path, 'w') as f:
        for p in temp_files:
            f.write(f"file '{p}'\n")

    try:
        input_args = {'f': 'concat', 'safe': 0}
        concat = ffmpeg.input(list_path, **input_args)
        
        video_stream = concat.video
        audio_stream = concat.audio

        # Mix Background Music
        if args.audio and os.path.exists(args.audio):
            bgm = ffmpeg.input(args.audio).filter('volume', args.volume)
            # amix duration=first ensures we stop when video stops
            audio_stream = ffmpeg.filter([audio_stream, bgm], 'amix', duration='first', dropout_transition=2)

        # Final Render
        out = ffmpeg.output(
            video_stream, audio_stream, args.output,
            vcodec='copy', acodec='aac', audio_bitrate='192k',
            loglevel='error'
        )
        out.run(overwrite_output=True)
        print(args.output) # Return path to Node

    finally:
        if os.path.exists(list_path): os.remove(list_path)
        for p in temp_files:
            if os.path.exists(p): os.remove(p)

if __name__ == "__main__":
    main()
