import { useState, useCallback } from 'react';
import { WebIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';

async function createDracoEncoder() {
  const draco3d = await import('draco3d');
  const [encoder, decoder] = await Promise.all([
    draco3d.default.createEncoderModule({}),
    draco3d.default.createDecoderModule({}),
  ]);
  return { encoder, decoder };
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

export default function DracoPage() {
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const compress = useCallback(async (file) => {
    if (!file || !file.name.endsWith('.glb')) {
      setError('Only .glb files supported');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setResult(null);
    setError('');

    try {
      const originalSize = file.size;
      const arrayBuffer = await file.arrayBuffer();

      setStatus('loading-draco');
      const { encoder, decoder } = await createDracoEncoder();

      const io = new WebIO()
        .registerExtensions(KHRONOS_EXTENSIONS)
        .registerDependencies({
          'draco3d.encoder': encoder,
          'draco3d.decoder': decoder,
        });

      setStatus('compressing');
      const document = await io.readBinary(new Uint8Array(arrayBuffer));
      await document.transform(draco());
      const compressed = await io.writeBinary(document);

      const blob = new Blob([compressed], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const outName = file.name.replace('.glb', '-draco.glb');

      setResult({ url, outName, originalSize, compressedSize: compressed.byteLength });
      setStatus('done');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) compress(file);
  }, [compress]);

  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (file) compress(file);
  };

  const savings = result
    ? (((result.originalSize - result.compressedSize) / result.originalSize) * 100).toFixed(1)
    : null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>GLB Draco Compressor</h1>

        <div
          style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById('fileInput').click()}
        >
          {status === 'idle' && <p>Drop .glb file here or click to browse</p>}
          {status === 'loading' && <p>Reading file...</p>}
          {status === 'loading-draco' && <p>Loading Draco encoder...</p>}
          {status === 'compressing' && <p>Compressing...</p>}
          {status === 'done' && <p>Done — drop another file</p>}
          {status === 'error' && <p style={{ color: '#f87171' }}>Error — try again</p>}
        </div>

        <input
          id="fileInput"
          type="file"
          accept=".glb"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />

        {status === 'error' && (
          <p style={styles.error}>{error}</p>
        )}

        {result && (
          <div style={styles.result}>
            <div style={styles.stats}>
              <div style={styles.stat}>
                <span style={styles.label}>Original</span>
                <span style={styles.value}>{formatMB(result.originalSize)}</span>
              </div>
              <div style={styles.arrow}>→</div>
              <div style={styles.stat}>
                <span style={styles.label}>Compressed</span>
                <span style={styles.value}>{formatMB(result.compressedSize)}</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.label}>Saved</span>
                <span style={{ ...styles.value, color: '#4ade80' }}>{savings}%</span>
              </div>
            </div>
            <a href={result.url} download={result.outName} style={styles.downloadBtn}>
              Download {result.outName}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f0f0f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    color: '#fff',
  },
  card: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 12,
    padding: 40,
    width: 480,
    maxWidth: '90vw',
  },
  title: {
    margin: '0 0 28px',
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: 1,
  },
  dropzone: {
    border: '2px dashed #444',
    borderRadius: 8,
    padding: '40px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    color: '#888',
    transition: 'border-color 0.2s',
  },
  dropzoneActive: {
    borderColor: '#fff',
    color: '#fff',
  },
  result: {
    marginTop: 24,
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 11,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    fontSize: 18,
    fontWeight: 600,
  },
  arrow: {
    color: '#555',
    fontSize: 20,
  },
  downloadBtn: {
    display: 'block',
    background: '#fff',
    color: '#000',
    textAlign: 'center',
    padding: '12px 20px',
    borderRadius: 6,
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 14,
  },
  error: {
    marginTop: 12,
    color: '#f87171',
    fontSize: 13,
  },
};
