import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [activeTab, setActiveTab] = useState('transcription');
  const [model, setModel] = useState('small');
  const [device, setDevice] = useState('wasm');
  const [hasWebGPU, setHasWebGPU] = useState(false);
  
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, processing-audio, loading-model, transcribing, completed, error
  const [statusMessage, setStatusMessage] = useState('');
  
  // Model loading downloads
  const [downloads, setDownloads] = useState({});
  const [totalProgress, setTotalProgress] = useState(0);
  
  const [transcript, setTranscript] = useState(null);
  const [timeTaken, setTimeTaken] = useState(0);
  
  const workerRef = useRef(null);
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);

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
      const { status: wsStatus, message, file: filename, progress, loaded, total, transcript: output, duration, error } = event.data;

      if (wsStatus === 'loading-model') {
        setStatus('loading-model');
        setStatusMessage(message);
      } else if (wsStatus === 'transcribing') {
        setStatus('transcribing');
        setStatusMessage(message);
      } else if (wsStatus === 'download-progress') {
        setStatus('loading-model');
        setDownloads((prev) => {
          const next = { ...prev, [filename]: progress };
          // Calculate average progress
          const values = Object.values(next);
          const sum = values.reduce((a, b) => a + b, 0);
          setTotalProgress(Math.round(sum / values.length));
          return next;
        });
      } else if (wsStatus === 'completed') {
        setStatus('completed');
        setTranscript(output);
        setTimeTaken(duration);
      } else if (wsStatus === 'error') {
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

  const decodeAudio = async (file) => {
    setStatus('processing-audio');
    setStatusMessage('Décodage de l\'audio...');
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await file.arrayBuffer();
    
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // Get mono channel data
      return audioBuffer.getChannelData(0);
    } catch (err) {
      throw new Error("Impossible de décoder l'audio. Vérifiez que c'est un fichier MP3/WAV valide.");
    }
  };

  const startTranscription = async () => {
    if (!file) return;
    setStatus('processing-audio');
    setDownloads({});
    setTotalProgress(0);

    try {
      const audioData = await decodeAudio(file);
      setStatus('loading-model');
      setStatusMessage('Initialisation du modèle Whisper...');
      
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
      <header>
        <h1 style={{ marginBottom: '24px' }}>Plus d'excuses</h1>
      </header>

      {/* Desktop Navigation */}
      <nav className="nav-desktop">
        <button className={activeTab === 'transcription' ? 'active' : ''} onClick={() => setActiveTab('transcription')}>Transcription</button>
        <button className={activeTab === 'player' ? 'active' : ''} onClick={() => setActiveTab('player')}>Player</button>
        <button className={activeTab === 'librairie' ? 'active' : ''} onClick={() => setActiveTab('librairie')}>Librairie</button>
      </nav>

      {/* Main Views */}
      {activeTab === 'transcription' && (
        <>
          <div className="controls-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="control-group">
              <label>Choisis un modèle</label>
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

          <div className="dropzone">
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
                <span>{status === 'processing-audio' ? 'Traitement audio...' : status === 'loading-model' ? 'Chargement du modèle...' : 'Transcription en cours...'}</span>
                {status === 'loading-model' && <span>{totalProgress}%</span>}
              </div>
              <div className="progress-track">
                <div 
                  className="progress-bar" 
                  style={{ width: `${status === 'loading-model' ? totalProgress : status === 'transcribing' ? 100 : 0}%` }}
                ></div>
              </div>
              <div className="progress-details">
                <span>{statusMessage}</span>
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
              
              <div className="dropzone" style={{ width: '100%', maxWidth: '400px', margin: '20px auto 0' }}>
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
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
                <h3 style={{ fontFamily: 'Outfit', marginBottom: '8px' }}>{file.name}</h3>
                <audio 
                  ref={audioRef}
                  src={audioUrl} 
                  controls 
                  style={{ width: '100%', marginTop: '16px' }}
                  onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                />
                
                {/* Reset button to clear loaded audio */}
                <button 
                  className="btn" 
                  style={{ width: 'auto', background: 'transparent', border: '1px solid var(--border-color)', boxShadow: 'none', padding: '6px 12px', fontSize: '0.8rem', marginTop: '12px' }}
                  onClick={() => {
                    setFile(null);
                    setTranscript(null);
                  }}
                >
                  Changer de fichier audio
                </button>
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
