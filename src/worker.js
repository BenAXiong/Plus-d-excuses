import { pipeline } from '@huggingface/transformers';

// Keep track of loaded models
let pipe = null;
let currentModel = null;
let currentDevice = null;

self.addEventListener('message', async (event) => {
  const { type, audioData, modelName, device } = event.data;

  if (type === 'transcribe') {
    try {
      self.postMessage({ status: 'loading-model', message: 'Chargement du modèle...' });

      // Load model if it's different or not loaded
      if (!pipe || currentModel !== modelName || currentDevice !== device) {
        currentModel = modelName;
        currentDevice = device;
        
        // Map model selections to HuggingFace ONNX weights
        // Using official onnx-community repository
        let modelId = `onnx-community/whisper-${modelName}`;
        if (modelName === 'medium') {
          modelId = 'onnx-community/whisper-medium-ONNX';
        }

        const pipelineOptions = {
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
        };

        // Use quantization to avoid WASM OOM (2GB limit)
        if (device === 'wasm') {
          pipelineOptions.dtype = 'q8';
        }

        pipe = await pipeline('automatic-speech-recognition', modelId, pipelineOptions);
      }

      console.log("Worker: Starting transcription. audioData length:", audioData?.length, "model:", modelName, "device:", device);
      self.postMessage({ status: 'transcribing', message: 'Transcription en cours...' });

      // Run transcription
      const startTime = performance.now();
      let chunksProcessed = 0;
      const output = await pipe(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'french',
        task: 'transcribe',
        return_timestamps: true,
        chunk_callback: (chunk) => {
          chunksProcessed++;
          console.log(`Worker: Chunk processed (${chunksProcessed})`, chunk?.text?.substring(0, 30));
          self.postMessage({
            status: 'transcribing-progress',
            chunksProcessed
          });
        }
      });
      const endTime = performance.now();
      console.log("Worker: Transcription completed in", (endTime - startTime) / 1000, "s. Output:", output);

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
