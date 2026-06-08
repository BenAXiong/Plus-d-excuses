import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [activeTab, setActiveTab] = useState('transcription');
  const [model, setModel] = useState('small');
  const [device, setDevice] = useState('wasm');
  const [hasWebGPU, setHasWebGPU] = useState(false);
  
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, processing-audio, loading-model, transcribing, completed, error
  const [statusMessage, setStatusMessage] = useState('');
  
  // Model loading downloads
  const [downloads, setDownloads] = useState({});
  const [totalProgress, setTotalProgress] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  
  const [transcript, setTranscript] = useState(null);
  const [timeTaken, setTimeTaken] = useState(0);
  
  const workerRef = useRef(null);
  const audioRef = useRef(null);
  const activeRef = useRef(null);
  const totalChunksRef = useRef(0);
  const transcribingIntervalRef = useRef(null);
  const audioDurationRef = useRef(0);
  const p1TargetRef = useRef(5);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);

  // Custom Player States
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [peaksData, setPeaksData] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);

  const canvasRef = useRef(null);
  const dragRef = useRef({ isDragging: false, startX: 0, startScrollLeft: 0, hasDragged: false });

  // Auto-scroll transcript when active segment changes
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [currentTime]);

  // Decode audio and generate high-density waveform peaks when file changes
  useEffect(() => {
    if (!file) {
      setPeaksData([]);
      setDuration(0);
      setZoom(1);
      setScrollLeft(0);
      return;
    }
    
    const loadAudioWaveform = async () => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        setDuration(audioBuffer.duration);
        
        const channelData = audioBuffer.getChannelData(0);
        const points = 24000;
        const step = Math.ceil(channelData.length / points);
        const newPeaksData = [];
        
        for (let i = 0; i < points; i++) {
          let min = 1.0;
          let max = -1.0;
          for (let j = 0; j < step; j++) {
            const index = i * step + j;
            if (index >= channelData.length) break;
            const datum = channelData[index];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
          }
          newPeaksData.push({ min, max });
        }
        
        // Find max amplitude to normalize
        const maxVal = Math.max(...newPeaksData.map(p => Math.max(Math.abs(p.min), Math.abs(p.max))));
        const normalized = newPeaksData.map(p => ({
          min: maxVal > 0 ? p.min / maxVal : 0,
          max: maxVal > 0 ? p.max / maxVal : 0
        }));
        
        setPeaksData(normalized);
        setZoom(1);
        setScrollLeft(0);
      } catch (err) {
        console.error("Failed to generate waveform:", err);
      }
    };
    
    loadAudioWaveform();
  }, [file]);

  // Redraw canvas waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaksData.length === 0) return;
    const ctx = canvas.getContext('2d');
    
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    const midY = h / 2;
    
    ctx.clearRect(0, 0, w, h);
    
    // Draw background grid lines (Audacity style)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();
    
    for (let i = 1; i < 10; i++) {
      const xGrid = (i / 10) * w;
      ctx.beginPath();
      ctx.moveTo(xGrid, 0);
      ctx.lineTo(xGrid, h);
      ctx.stroke();
    }
    
    const visiblePoints = Math.round(peaksData.length / zoom);
    
    // Helper to draw a continuous filled waveform segment with linear interpolation
    const drawWaveformSegment = (startX, endX, fillStyle) => {
      if (startX >= endX) return;
      ctx.beginPath();
      
      // Top outline (left to right)
      for (let x = startX; x <= endX; x++) {
        const dataIdx = scrollLeft + (x / w) * visiblePoints;
        const baseIdx = Math.floor(dataIdx);
        const frac = dataIdx - baseIdx;
        
        let maxVal = 0;
        if (baseIdx < peaksData.length) {
          const p1 = peaksData[baseIdx].max;
          const p2 = baseIdx + 1 < peaksData.length ? peaksData[baseIdx + 1].max : p1;
          maxVal = p1 + (p2 - p1) * frac;
        }
        
        const y = midY + (maxVal * midY * 0.9);
        if (x === startX) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      // Bottom outline (right to left)
      for (let x = endX; x >= startX; x--) {
        const dataIdx = scrollLeft + (x / w) * visiblePoints;
        const baseIdx = Math.floor(dataIdx);
        const frac = dataIdx - baseIdx;
        
        let minVal = 0;
        if (baseIdx < peaksData.length) {
          const p1 = peaksData[baseIdx].min;
          const p2 = baseIdx + 1 < peaksData.length ? peaksData[baseIdx + 1].min : p1;
          minVal = p1 + (p2 - p1) * frac;
        }
        
        const y = midY + (minVal * midY * 0.9);
        ctx.lineTo(x, y);
      }
      
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
    };

    // Calculate playhead position in pixels
    const currentPointIdx = (currentTime / duration) * peaksData.length;
    const playheadX = ((currentPointIdx - scrollLeft) / visiblePoints) * w;
    const splitX = Math.round(Math.max(0, Math.min(w, playheadX)));

    // Create custom linear gradients
    const playedGradient = ctx.createLinearGradient(0, 0, 0, h);
    playedGradient.addColorStop(0, '#a5b4fc'); // Indigo-300
    playedGradient.addColorStop(0.5, '#6366f1'); // Indigo-500
    playedGradient.addColorStop(1, '#4338ca'); // Indigo-700

    const unplayedGradient = ctx.createLinearGradient(0, 0, 0, h);
    unplayedGradient.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    unplayedGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.14)');
    unplayedGradient.addColorStop(1, 'rgba(255, 255, 255, 0.08)');

    // Render both active and inactive parts of the waveform
    drawWaveformSegment(0, splitX, playedGradient);
    drawWaveformSegment(splitX, w, unplayedGradient);
    
    // Draw playhead vertical line
    const visibleEnd = scrollLeft + visiblePoints;
    if (currentPointIdx >= scrollLeft && currentPointIdx <= visibleEnd) {
      ctx.strokeStyle = '#f43f5e'; // Vibrant pink/red playhead
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, h);
      ctx.stroke();
      
      // Draw a small playhead triangle on top
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(splitX - 6, 0);
      ctx.lineTo(splitX + 6, 0);
      ctx.lineTo(splitX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [peaksData, currentTime, zoom, scrollLeft, duration]);

  // Keep playhead visible inside the zoomed viewport
  useEffect(() => {
    if (peaksData.length === 0) return;
    const currentPointIdx = (currentTime / duration) * peaksData.length;
    const visiblePoints = Math.round(peaksData.length / zoom);
    const visibleEnd = scrollLeft + visiblePoints;
    
    if (currentPointIdx > visibleEnd - (visiblePoints * 0.15) || currentPointIdx < scrollLeft) {
      const targetScrollLeft = Math.max(
        0,
        Math.min(
          peaksData.length - visiblePoints,
          Math.round(currentPointIdx - visiblePoints * 0.2)
        )
      );
      setScrollLeft(targetScrollLeft);
    }
  }, [currentTime, duration, zoom]);

  // Attach non-passive wheel handler for zooming
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const w = rect.width;
      
      const zoomFactor = e.deltaY < 0 ? 1.3 : 0.77;
      const nextZoom = Math.max(1, Math.min(80, zoom * zoomFactor));
      
      const oldVisiblePoints = peaksData.length / zoom;
      const newVisiblePoints = peaksData.length / nextZoom;
      const mousePercentage = x / w;
      const pointAtMouse = scrollLeft + mousePercentage * oldVisiblePoints;
      
      const nextScrollLeft = Math.max(
        0,
        Math.min(
          peaksData.length - newVisiblePoints,
          Math.round(pointAtMouse - mousePercentage * newVisiblePoints)
        )
      );
      
      setZoom(nextZoom);
      setScrollLeft(nextScrollLeft);
    };
    
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [zoom, scrollLeft, peaksData]);

  const handleCanvasClick = (e) => {
    if (dragRef.current.hasDragged) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    
    const visiblePoints = Math.round(peaksData.length / zoom);
    const dataIdx = scrollLeft + (x / w) * visiblePoints;
    const clickTime = (dataIdx / peaksData.length) * duration;
    
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(duration, clickTime));
    }
  };

  const handleMouseDown = (e) => {
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startScrollLeft: scrollLeft,
      hasDragged: false
    };
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 3) {
      dragRef.current.hasDragged = true;
    }
    
    const visiblePoints = Math.round(peaksData.length / zoom);
    const pointDelta = -(dx / w) * visiblePoints;
    
    const newScrollLeft = Math.max(
      0,
      Math.min(
        peaksData.length - visiblePoints,
        Math.round(dragRef.current.startScrollLeft + pointDelta)
      )
    );
    setScrollLeft(newScrollLeft);
  };

  const handleMouseUpOrLeave = () => {
    dragRef.current.isDragging = false;
  };

  // Set audio URL when file changes
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioUrl(null);
    }
  }, [file]);

  // Detect WebGPU
  useEffect(() => {
    if (navigator.gpu) {
      setHasWebGPU(true);
      setDevice('webgpu'); // Default to WebGPU if available
    }
  }, []);

  // Initialize Worker
  useEffect(() => {
    workerRef.current = new Worker(
      new URL('./worker.js', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.addEventListener('message', (event) => {
      const { status: wsStatus, message, file: filename, progress, loaded, total, transcript: output, duration, error, chunksProcessed } = event.data;

      // Helper to stop fake progress interval
      const clearTranscribingInterval = () => {
        if (transcribingIntervalRef.current) {
          clearInterval(transcribingIntervalRef.current);
          transcribingIntervalRef.current = null;
        }
      };

      if (wsStatus === 'loading-model') {
        setStatus('loading-model');
        setStatusMessage(message);
      } else if (wsStatus === 'transcribing') {
        setStatus('transcribing');
        setStatusMessage(message);
        
        // Start a smooth fake progress interval for Phase 3 so it never gets stuck at 10%
        if (!transcribingIntervalRef.current) {
          setTotalProgress(10);
          
          // Estimate total transcription time in seconds based on device and file duration
          const audioDur = audioDurationRef.current || 60;
          const estTime = device === 'webgpu' 
            ? Math.max(5, audioDur * 0.08)  // WebGPU: ~8% of audio duration (e.g. 15s for a 3min file)
            : Math.max(20, audioDur * 0.7); // WASM (CPU): ~70% of audio duration (e.g. 126s for a 3min file)
          
          const tickMs = 500;
          const totalTicks = (estTime * 1000) / tickMs;
          const baseIncrement = 85 / totalTicks; // We need to cover 85% (from 10% to 95%)

          transcribingIntervalRef.current = setInterval(() => {
            setTotalProgress((p) => {
              if (p < 95) {
                // Decay the speed slightly as it approaches 95% to prevent overshooting early
                const decay = p < 40 ? 1.0 : p < 75 ? 0.6 : 0.35;
                const nextVal = p + (baseIncrement * decay);
                return Math.min(95, nextVal);
              }
              return p;
            });
          }, tickMs);
        }
      } else if (wsStatus === 'download-progress') {
        setStatus('loading-model');
        setDownloads((prev) => {
          const next = { ...prev, [filename]: progress };
          // Calculate average progress
          const values = Object.values(next);
          const sum = values.reduce((a, b) => a + b, 0);
          const downloadAverage = sum / values.length;
          
          // Phase 2: Map 0% - 100% download progress to p1Target - 10% overall progress
          const startBound = p1TargetRef.current;
          const span = 10 - startBound;
          setTotalProgress(startBound + Math.round(downloadAverage * span / 100));
          return next;
        });
      } else if (wsStatus === 'transcribing-progress') {
        setStatus('transcribing');
        setStatusMessage(`Transcription en cours... (segment ${chunksProcessed} / ${totalChunksRef.current || '?'})`);
        
        // Phase 3: Update progress based on real chunk callback if higher than current progress
        if (totalChunksRef.current > 0) {
          const transProgress = 10 + Math.round((chunksProcessed / totalChunksRef.current) * 85);
          setTotalProgress((current) => Math.max(current, Math.min(97, transProgress)));
        }
      } else if (wsStatus === 'completed') {
        clearTranscribingInterval();
        setStatus('completed');
        setTotalProgress(100);
        setTranscript(output);
        setTimeTaken(duration);
      } else if (wsStatus === 'error') {
        clearTranscribingInterval();
        setStatus('error');
        setStatusMessage(error);
      }
    });

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setStatus('idle');
      setTranscript(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const selectedFile = e.dataTransfer.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setStatus('idle');
      setTranscript(null);
    }
  };

  const decodeAudio = async (file) => {
    setStatus('processing-audio');
    setStatusMessage('Décodage de l\'audio...');
    
    // Calculate Phase 1 target dynamically (e.g., ~5% for 3min file, using file size as proxy)
    const p1Target = Math.max(2, Math.min(6, Math.round((file.size / (1024 * 1024)) * 1.3)));
    p1TargetRef.current = p1Target;
    
    // Simulate decoding progress up to p1Target
    setTotalProgress(1);
    const interval = setInterval(() => {
      setTotalProgress(p => p < p1Target ? p + 1 : p);
    }, 150);
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await file.arrayBuffer();
    
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      clearInterval(interval);
      setTotalProgress(p1Target);
      return audioBuffer;
    } catch (err) {
      clearInterval(interval);
      throw new Error("Impossible de décoder l'audio. Vérifiez que c'est un fichier MP3/WAV valide.");
    }
  };

  const startTranscription = async () => {
    if (!file) return;
    setStatus('processing-audio');
    setDownloads({});
    setTotalProgress(0);

    try {
      const audioBuffer = await decodeAudio(file);
      const audioDuration = audioBuffer.duration;
      audioDurationRef.current = audioDuration;
      
      // Whisper processes in 30s chunks. Stride shifts forward by 25s.
      const estimatedChunks = Math.max(1, Math.ceil(audioDuration / 25));
      setTotalChunks(estimatedChunks);
      totalChunksRef.current = estimatedChunks;

      setStatus('loading-model');
      setStatusMessage('Initialisation du modèle Whisper...');
      
      const audioData = audioBuffer.getChannelData(0);
      workerRef.current.postMessage({
        type: 'transcribe',
        audioData,
        modelName: model,
        device
      });
    } catch (err) {
      setStatus('error');
      setStatusMessage(err.message);
    }
  };

  // Format seconds to SRT format HH:MM:SS,mmm
  const formatSRTTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${hrs}:${mins}:${secs},${ms}`;
  };

  const generateSRT = () => {
    if (!transcript || !transcript.chunks) return '';
    return transcript.chunks.map((chunk, index) => {
      const start = formatSRTTime(chunk.timestamp[0]);
      const end = formatSRTTime(chunk.timestamp[1] || chunk.timestamp[0] + 2);
      return `${index + 1}\n${start} --> ${end}\n${chunk.text.trim()}\n`;
    }).join('\n');
  };

  const downloadSRT = () => {
    const srtContent = generateSRT();
    const blob = new Blob([srtContent], { type: 'text/srt;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${file.name.replace(/\.[^/.]+$/, "")}.srt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSRTUpload = (e) => {
    const srtFile = e.target.files[0];
    if (!srtFile) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const chunks = [];
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const blocks = normalized.trim().split('\n\n');
      
      for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length >= 3) {
          const timeLine = lines[1];
          const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
          if (match) {
            const start = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 1000;
            const end = parseInt(match[5]) * 3600 + parseInt(match[6]) * 60 + parseInt(match[7]) + parseInt(match[8]) / 1000;
            const textContent = lines.slice(2).join(' ').trim();
            chunks.push({
              timestamp: [start, end],
              text: textContent
            });
          }
        }
      }
      setTranscript({ chunks });
    };
    reader.readAsText(srtFile);
  };

  return (
    <div className="app-container">
      <div className="header-container">
        <h1>Plus d'excuses</h1>
        
        {/* Desktop Navigation */}
        <nav className="nav-desktop">
          <button className={activeTab === 'transcription' ? 'active' : ''} onClick={() => setActiveTab('transcription')}>Transcription</button>
          <button className={activeTab === 'player' ? 'active' : ''} onClick={() => setActiveTab('player')}>Player</button>
          <button className={activeTab === 'librairie' ? 'active' : ''} onClick={() => setActiveTab('librairie')}>Librairie</button>
        </nav>
      </div>

      {/* Main Views */}
      {activeTab === 'transcription' && (
        <>
          <div className="controls-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="control-group">
              <label>Choisis un modèle</label>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: '16px', lineHeight: '1.4' }}>
                Plus le modèle est gros, plus il est précis, mais plus il est lent. Si ton appareil est puissant, tu peux essayer Medium, sinon commence par Small.
              </p>
              <div className="segmented-control">
                {[
                  { id: 'tiny', label: 'Tiny' },
                  { id: 'small', label: 'Small' },
                  { id: 'medium', label: 'Medium' },
                  { id: 'large-v3-turbo', label: 'Large' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={model === m.id ? 'active' : ''}
                    onClick={() => setModel(m.id)}
                    disabled={status !== 'idle' && status !== 'completed' && status !== 'error'}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div 
            className={`dropzone ${isDragging ? 'active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              accept="audio/*" 
              id="audio-picker" 
              style={{ display: 'none' }} 
              onChange={handleFileChange}
              disabled={status !== 'idle' && status !== 'completed' && status !== 'error'}
            />
            <label htmlFor="audio-picker" style={{ width: '100%', cursor: 'pointer' }}>
              <div className="dropzone-icon">📥</div>
              {file ? (
                <div className="file-info">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
              ) : (
                <div>
                  <p style={{ color: 'var(--text-primary)', fontWeight: '500' }}>Sélectionnez un fichier audio</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>MP3, WAV, M4A, etc.</p>
                </div>
              )}
            </label>
          </div>

          {status !== 'idle' && status !== 'completed' && (
            <div className="progress-card">
              <div className="status-text">
                <span>
                  {status === 'processing-audio' 
                    ? '1. Décodage Audio...' 
                    : totalProgress < 60 
                    ? '2. Téléchargement du Modèle...' 
                    : '3. Transcription par l\'IA...'}
                </span>
                <span>{Math.round(totalProgress)}%</span>
              </div>
              
              <div className="progress-track">
                <div 
                  className="progress-bar" 
                  style={{ width: `${Math.round(totalProgress)}%` }}
                ></div>
              </div>

              <div className="progress-details" style={{ marginBottom: '16px' }}>
                <span>{statusMessage}</span>
              </div>

              {/* 3-Step Progress Dots */}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '16px', gap: '8px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                  <div style={{ 
                    width: '14px', 
                    height: '14px', 
                    borderRadius: '50%', 
                    background: totalProgress >= 10 ? 'var(--success)' : 'var(--accent)', 
                    boxShadow: totalProgress < 10 ? '0 0 8px var(--accent)' : 'none',
                    transition: 'all 0.3s ease',
                    marginBottom: '6px'
                  }}></div>
                  <span style={{ fontSize: '0.75rem', fontWeight: totalProgress < 10 ? '600' : '400', color: totalProgress < 10 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    Audio
                  </span>
                </div>
                
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                  <div style={{ 
                    width: '14px', 
                    height: '14px', 
                    borderRadius: '50%', 
                    background: totalProgress >= 60 ? 'var(--success)' : totalProgress >= 10 ? 'var(--accent)' : 'rgba(255,255,255,0.1)', 
                    boxShadow: (totalProgress >= 10 && totalProgress < 60) ? '0 0 8px var(--accent)' : 'none',
                    transition: 'all 0.3s ease',
                    marginBottom: '6px'
                  }}></div>
                  <span style={{ fontSize: '0.75rem', fontWeight: (totalProgress >= 10 && totalProgress < 60) ? '600' : '400', color: (totalProgress >= 10 && totalProgress < 60) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    Modèle Whisper
                  </span>
                </div>
                
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                  <div style={{ 
                    width: '14px', 
                    height: '14px', 
                    borderRadius: '50%', 
                    background: totalProgress >= 100 ? 'var(--success)' : totalProgress >= 60 ? 'var(--accent)' : 'rgba(255,255,255,0.1)', 
                    boxShadow: (totalProgress >= 60 && totalProgress < 100) ? '0 0 8px var(--accent)' : 'none',
                    transition: 'all 0.3s ease',
                    marginBottom: '6px'
                  }}></div>
                  <span style={{ fontSize: '0.75rem', fontWeight: (totalProgress >= 60 && totalProgress < 100) ? '600' : '400', color: (totalProgress >= 60 && totalProgress < 100) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    Transcription IA
                  </span>
                </div>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div style={{ color: 'var(--danger)', padding: '16px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '8px', marginBottom: '24px', fontSize: '0.9rem' }}>
              <strong>Erreur:</strong> {statusMessage}
            </div>
          )}

          <button 
            className="btn" 
            onClick={startTranscription} 
            disabled={!file || (status !== 'idle' && status !== 'completed' && status !== 'error')}
          >
            Démarrer la transcription
          </button>

          {status === 'completed' && transcript && (
            <div className="transcript-section">
              <div className="transcript-header">
                <div>
                  <h3 style={{ fontFamily: 'Outfit', fontSize: '1.2rem' }}>Transcription Terminée</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Terminé en {timeTaken.toFixed(1)}s</p>
                </div>
                <button className="btn" style={{ width: 'auto', padding: '8px 16px', fontSize: '0.85rem' }} onClick={downloadSRT}>
                  Télécharger .SRT
                </button>
              </div>
              <div className="transcript-box">
                {transcript.chunks && transcript.chunks.map((chunk, index) => (
                  <div key={index} className="transcript-segment">
                    <span className="segment-time">
                      [{formatSRTTime(chunk.timestamp[0]).substring(3, 8)} - {formatSRTTime(chunk.timestamp[1] || chunk.timestamp[0] + 2).substring(3, 8)}]
                    </span>
                    <span className="segment-text">{chunk.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'player' && (
        <div className="player-view" style={{ animation: 'fadeIn 0.5s ease-out' }}>
          {!file ? (
            <div className="placeholder-view">
              <h2>Aucun fichier audio chargé</h2>
              <p>Sélectionnez un fichier audio pour commencer l'écoute.</p>
              
              <div 
                className={`dropzone ${isDragging ? 'active' : ''}`}
                style={{ width: '100%', maxWidth: '400px', margin: '20px auto 0' }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input 
                  type="file" 
                  accept="audio/*" 
                  id="player-audio-picker" 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange}
                />
                <label htmlFor="player-audio-picker" style={{ width: '100%', cursor: 'pointer' }}>
                  <div className="dropzone-icon">🎵</div>
                  <p style={{ color: 'var(--text-primary)', fontWeight: '500' }}>Charger un fichier audio</p>
                </label>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <button 
                    className="btn" 
                    title="Changer de fichier"
                    style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', boxShadow: 'none', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 }}
                    onClick={() => {
                      setFile(null);
                      setTranscript(null);
                    }}
                  >
                    📂
                  </button>
                  <h3 style={{ fontFamily: 'Outfit', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</h3>
                </div>
                
                <audio 
                  ref={audioRef}
                  src={audioUrl} 
                  onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onLoadedMetadata={(e) => setDuration(e.target.duration)}
                />

                {/* Custom Waveform Seekbar */}
                {peaksData.length > 0 ? (
                  <div style={{ position: 'relative', margin: '20px 0' }}>
                    <canvas
                      ref={canvasRef}
                      style={{
                        width: '100%',
                        height: '120px',
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        cursor: 'ew-resize',
                        display: 'block'
                      }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUpOrLeave}
                      onMouseLeave={handleMouseUpOrLeave}
                      onClick={handleCanvasClick}
                    />
                  </div>
                ) : (
                  <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-color)', borderRadius: '8px', margin: '20px 0' }}>
                    Chargement de la forme d'onde...
                  </div>
                )}

                {/* Controls Bar */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginTop: '20px', gap: '16px' }}>
                  {/* Left Column: Time */}
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', color: 'var(--text-primary)', justifySelf: 'start' }}>
                    {formatSRTTime(currentTime).substring(3, 8)} / {formatSRTTime(duration).substring(3, 8)}
                  </div>

                  {/* Center Column: Play/Pause */}
                  <button 
                    className="btn" 
                    style={{ width: '48px', height: '48px', borderRadius: '50%', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', justifySelf: 'center', cursor: 'pointer' }}
                    onClick={() => {
                      if (audioRef.current) {
                        if (isPlaying) {
                          audioRef.current.pause();
                        } else {
                          audioRef.current.play();
                        }
                      }
                    }}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>

                  {/* Right Column: Waveform Zoom Controls */}
                  <div style={{ display: 'flex', gap: '8px', justifySelf: 'end' }}>
                    <button 
                      type="button"
                      className="btn" 
                      title="Dézoomer"
                      style={{ width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', boxShadow: 'none', cursor: 'pointer' }}
                      onClick={() => {
                        setZoom(z => Math.max(1, z / 1.5));
                      }}
                    >
                      🔍-
                    </button>
                    <button 
                      type="button"
                      className="btn" 
                      title="Réinitialiser"
                      style={{ width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', boxShadow: 'none', cursor: 'pointer' }}
                      onClick={() => {
                        setZoom(1);
                        setScrollLeft(0);
                      }}
                    >
                      🔄
                    </button>
                    <button 
                      type="button"
                      className="btn" 
                      title="Zoomer"
                      style={{ width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', boxShadow: 'none', cursor: 'pointer' }}
                      onClick={() => {
                        setZoom(z => Math.min(80, z * 1.5));
                      }}
                    >
                      🔍+
                    </button>
                  </div>
                </div>
              </div>

              {transcript ? (
                <div>
                  <h3 style={{ fontFamily: 'Outfit', marginBottom: '16px' }}>Transcription Synchrone</h3>
                  <div className="transcript-box" style={{ maxHeight: '350px' }}>
                    {transcript.chunks.map((chunk, index) => {
                      const start = chunk.timestamp[0];
                      const end = chunk.timestamp[1] || start + 2;
                      const isActive = currentTime >= start && currentTime <= end;
                      
                      return (
                        <div 
                          key={index} 
                          ref={isActive ? activeRef : null}
                          className={`transcript-segment ${isActive ? 'active' : ''}`}
                          style={{ 
                            cursor: 'pointer', 
                            padding: '8px', 
                            borderRadius: '6px', 
                            background: isActive ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                            borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            gap: '12px'
                          }}
                          onClick={() => {
                            if (audioRef.current) {
                              audioRef.current.currentTime = start;
                              audioRef.current.play();
                            }
                          }}
                        >
                          <span className="segment-time" style={{ color: isActive ? 'var(--text-primary)' : 'var(--accent)', minWidth: '60px' }}>
                            [{formatSRTTime(start).substring(3, 8)}]
                          </span>
                          <span className="segment-text" style={{ fontWeight: isActive ? '600' : '400', flex: 1, textAlign: 'left' }}>
                            {chunk.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="placeholder-view" style={{ padding: '20px', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                  <h2 style={{ marginBottom: '24px' }}>Aucun sous-titre dans la librairie</h2>
                  
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <button className="btn" style={{ width: 'auto' }} onClick={() => setActiveTab('transcription')}>
                      Transcrire avec l'IA
                    </button>
                    
                    <input 
                      type="file" 
                      accept=".srt" 
                      id="srt-picker" 
                      style={{ display: 'none' }} 
                      onChange={handleSRTUpload}
                    />
                    <label htmlFor="srt-picker" className="btn" style={{ width: 'auto', display: 'inline-block', lineHeight: 'normal', cursor: 'pointer' }}>
                      Importer un fichier .srt
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'librairie' && (
        <div className="placeholder-view">
          <h2>Votre Librairie</h2>
          <p>Retrouvez ici l'historique de vos fichiers audio et de vos transcriptions.</p>
        </div>
      )}

      {/* Mobile Floating Bottom Nav */}
      <nav className="nav-mobile">
        <button className={activeTab === 'transcription' ? 'active' : ''} onClick={() => setActiveTab('transcription')}>
          <span className="nav-mobile-icon">🎙️</span>
          <span>Transcription</span>
        </button>
        <button className={activeTab === 'player' ? 'active' : ''} onClick={() => setActiveTab('player')}>
          <span className="nav-mobile-icon">🎵</span>
          <span>Player</span>
        </button>
        <button className={activeTab === 'librairie' ? 'active' : ''} onClick={() => setActiveTab('librairie')}>
          <span className="nav-mobile-icon">📚</span>
          <span>Librairie</span>
        </button>
      </nav>
    </div>
  );
}
