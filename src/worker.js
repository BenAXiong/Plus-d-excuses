import { pipeline } from '@huggingface/transformers';

// Keep track of loaded models
let pipe = null;
let currentModel = null;
let currentDevice = null;

self.addEventListener('message', async (event) => {
  const { type, audioData, modelName, device } = event.data;

  if (type === 'transcribe') {
    try {
      self.postMessage({ status: 'status', message: 'Loading model...' });

      // Load model if it's different or not loaded
      if (!pipe || currentModel !== modelName || currentDevice !== device) {
        currentModel = modelName;
        currentDevice = device;
        
        // Map model selections to HuggingFace ONNX weights
        // Using official onnx-community repository
        const modelId = `onnx-community/whisper-${modelName}`;

        pipe = await pipeline('automatic-speech-recognition', modelId, {
          device: device, // 'webgpu' or 'wasm'
          progress_callback: (progress) => {
            if (progress.status === 'progress') {
              self.postMessage({
                status: 'download-progress',
                file: progress.file,
                progress: progress.progress,
                loaded: progress.loaded,
                total: progress.total
              });
            }
          }
        });
      }

      self.postMessage({ status: 'status', message: 'Transcribing audio...' });

      // Run transcription
      const startTime = performance.now();
      const output = await pipe(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'french',
        task: 'transcribe',
        return_timestamps: true,
      });
      const endTime = performance.now();

      self.postMessage({
        status: 'completed',
        transcript: output,
        duration: (endTime - startTime) / 1000
      });

    } catch (error) {
      console.error(error);
      self.postMessage({ status: 'error', error: error.message });
    }
  }
});
