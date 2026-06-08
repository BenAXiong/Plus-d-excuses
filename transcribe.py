import sys
import subprocess
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <path_to_audio_file>")
        sys.exit(1)
        
    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(f"Error: File '{audio_path}' does not exist.")
        sys.exit(1)
        
    output_dir = os.path.dirname(audio_path) or "."
    
    cmd = [
        "whisperx",
        audio_path,
        "--model", "small",
        "--language", "fr",
        "--output_dir", output_dir,
        "--device", "cpu",
        "--compute_type", "int8",
        "--output_format", "srt"
    ]
    
    print(f"Starting WhisperX transcription on CPU (int8)...")
    print(f"Input: {audio_path}")
    print(f"Output Directory: {output_dir}")
    print("-" * 50)
    
    try:
        subprocess.run(cmd, check=True)
        print("-" * 50)
        print("Transcription completed successfully!")
    except subprocess.CalledProcessError as e:
        print(f"Error during transcription: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
