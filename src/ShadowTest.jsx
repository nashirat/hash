import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Line } from '@react-three/drei';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { bakeShadowWithWorker, downloadShadowJson } from './shadowBakerUtils.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

useGLTF.preload('/Kiri.glb');
useGLTF.preload('/Tengah.glb');
useGLTF.preload('/Kanan.glb');

const DEG = Math.PI / 180;

const SCENE_FLOWERS = [
  { file: '/Kiri.glb',   pos: [-3.4, 1, 0],    rot: [7, -3, -21],     scale: 0.6                  },
  { file: '/Tengah.glb', pos: [-0.5, -1.5, 0],  rot: [0, -21, 0],      scale: 1.2                  },
  { file: '/Kanan.glb',  pos: [5.3, -0.8, 0],   rot: [-16, 345, -135], scale: 4.5, meshOnly: true  },
];


function SceneGroup({ bake, bakeKey, shadowParams, transforms, onProgress, onDone }) {
  const { scene: s0 } = useGLTF('/Kiri.glb');
  const { scene: s1 } = useGLTF('/Tengah.glb');
  const { scene: s2 } = useGLTF('/Kanan.glb');

  const scenes = useMemo(() => [s0, s1, s2].map((raw, i) => {
    const scene = raw.clone();
    const cfg   = SCENE_FLOWERS[i];
    const box   = new THREE.Box3();
    if (cfg.meshOnly) {
      scene.traverse((c) => { if (c.isMesh) box.expandByObject(c); });
      if (box.isEmpty()) box.setFromObject(scene);
    } else {
      box.setFromObject(scene);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const sc     = 2 / Math.max(size.x, size.y, size.z);
    scene.scale.setScalar(sc);
    scene.position.set(-center.x * sc, -center.y * sc, -center.z * sc);
    return scene;
  }), [s0, s1, s2]);

  const groupRef = useRef();

  // Re-run bake each time bakeKey increments
  useEffect(() => {
    if (!bake || !groupRef.current) return;
    bakeShadowWithWorker(groupRef.current, shadowParams, onProgress)
      .then(onDone)
      .catch((e) => console.error('Bake failed:', e));
  }, [bakeKey]);

  return (
    <group ref={groupRef}>
      {scenes.map((scene, i) => {
        const { pos, rot, scale } = transforms[i];
        return (
          <group
            key={i}
            position={pos}
            rotation={[rot[0] * DEG, rot[1] * DEG, rot[2] * DEG]}
            scale={scale}
          >
            <primitive object={scene} />
          </group>
        );
      })}
    </group>
  );
}

function Knob({ label, step, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const commit = (raw) => { const n = parseFloat(raw); setDraft(null); if (!isNaN(n)) onChange(n); };
  const nudge = (dir) => onChange(parseFloat((value + dir * step).toFixed(10)));
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={s.knobLabel}>{label}</div>
      <div style={s.row}>
        <button style={s.arrow} onClick={() => nudge(-1)}>▼</button>
        <input
          type="text"
          value={draft ?? Number(value).toFixed(3)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.target.value);
            if (e.key === 'Escape') setDraft(null);
            if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
          }}
          style={s.numInput}
        />
        <button style={s.arrow} onClick={() => nudge(1)}>▲</button>
      </div>
    </div>
  );
}

function FlowerPanel({ label, transform, onChange }) {
  const [open, setOpen] = useState(false);
  const set = (key, ai, val) => {
    const next = { ...transform };
    if (ai !== null) { const arr = [...next[key]]; arr[ai] = val; next[key] = arr; }
    else next[key] = val;
    onChange(next);
  };
  return (
    <div style={{ borderBottom: '1px solid #1a1a2a', paddingBottom: 6, marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', marginBottom: open ? 6 : 0 }} onClick={() => setOpen(o => !o)}>
        <span style={{ color: '#c4b5fd', fontSize: 10, fontWeight: 700 }}>{label}</span>
        <span style={{ color: '#555', fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <div style={s.section}>Position</div>
          {['X', 'Y', 'Z'].map((ax, ai) => (
            <Knob key={ax} label={ax} step={0.1} value={transform.pos[ai]} onChange={(v) => set('pos', ai, v)} />
          ))}
          <div style={s.section}>Rotation (°)</div>
          {['X', 'Y', 'Z'].map((ax, ai) => (
            <Knob key={ax} label={ax} step={1} value={transform.rot[ai]} onChange={(v) => set('rot', ai, v)} />
          ))}
          <div style={s.section}>Scale</div>
          <Knob label="Scale" step={0.1} value={transform.scale} onChange={(v) => set('scale', null, v)} />
        </>
      )}
    </div>
  );
}

export default function ShadowTest() {
  const [light, setLight] = useState({ x: 2, y: 8, z: 4 });
  const setL = (k, v) => setLight((p) => ({ ...p, [k]: v }));
  const [ambient, setAmbient] = useState(0.9);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [bakeKey, setBakeKey] = useState(0);
  const [bakeTriggered, setBakeTriggered] = useState(false);
  const [bakedLight, setBakedLight] = useState({ x: 2, y: 8, z: 4 });
  const exportDataRef = useRef(null);
  const [transforms, setTransforms] = useState(SCENE_FLOWERS.map(f => ({
    pos: [...f.pos], rot: [...f.rot], scale: f.scale,
  })));
  const setTransform = (i, next) => setTransforms(prev => prev.map((t, ti) => ti === i ? next : t));

  const [smoothPasses, setSmoothPasses] = useState(0);
  const [shadowStrength, setShadowStrength] = useState(1.0);
  const [shadowDist, setShadowDist] = useState(10);
  const [aoRays, setAoRays] = useState(8);
  const [aoStrength, setAoStrength] = useState(0.3);
  const [aoMaxDist, setAoMaxDist] = useState(1.5);

  const shadowParams = {
    lx: bakedLight.x, ly: bakedLight.y, lz: bakedLight.z,
    dist: shadowDist, strength: shadowStrength, smoothPasses,
    aoRays, aoStrength, aoMaxDist,
  };

  const rebake = () => {
    setBakedLight({ x: light.x, y: light.y, z: light.z });
    setProgress(0);
    setDone(false);
    setBakeTriggered(true);
    setBakeKey((k) => k + 1);
  };

  const handleDone = (exportData) => {
    exportDataRef.current = exportData;
    setDone(true);
  };

  const exportShadow = () => {
    if (!exportDataRef.current) return;
    const payload = JSON.stringify({
      version: 1,
      lightDir: [bakedLight.x, bakedLight.y, bakedLight.z],
      meshes: exportDataRef.current,
    });
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scene_shadow.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0, 10], fov: 34 }} gl={{ antialias: true }} style={{ background: '#000000' }}>
        <ambientLight intensity={ambient} />
        <SceneGroup
          bake={bakeTriggered}
          bakeKey={bakeKey}
          shadowParams={shadowParams}
          transforms={transforms}
          onProgress={setProgress}
          onDone={handleDone}
        />
        <axesHelper args={[2]} />
        <Line
          points={[[light.x, light.y, light.z], [0, 0, 0]]}
          color={done ? '#444' : 'yellow'}
          lineWidth={done ? 0.5 : 2}
        />
        <mesh position={[light.x, light.y, light.z]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color={done ? '#444' : 'yellow'} />
        </mesh>
        <OrbitControls enableRotate={false} />
      </Canvas>

      <div style={s.panel}>
        <div style={s.title}>SHADOW TEST</div>
        <div style={{ color: done ? '#4ade80' : '#f59e0b', fontSize: 10, marginBottom: 8 }}>
          {done
            ? `✓ baked · light (${bakedLight.x},${bakedLight.y},${bakedLight.z})`
            : bakeTriggered ? `⟳ ${progress}%` : 'not baked'}
        </div>

        <div style={s.scroll}>
          <div style={s.section}>Ambient</div>
          <Knob label="Intensity" step={0.05} value={ambient} onChange={setAmbient} />

          <div style={s.section}>Shadow</div>
          <Knob label="Strength" step={0.05} value={shadowStrength} onChange={setShadowStrength} />
          <Knob label="Distance" step={0.5}  value={shadowDist}     onChange={setShadowDist} />
          <Knob label="Blur"     step={1}    value={smoothPasses}   onChange={(v) => setSmoothPasses(Math.max(0, Math.round(v)))} />

          <div style={s.section}>AO</div>
          <Knob label="Strength" step={0.05} value={aoStrength} onChange={setAoStrength} />
          <Knob label="Distance" step={0.5}  value={aoMaxDist}  onChange={setAoMaxDist} />
          <Knob label="Rays"     step={1}    value={aoRays}     onChange={(v) => setAoRays(Math.max(0, Math.round(v)))} />

          <div style={s.section}>Bake Light</div>
          {['x', 'y', 'z'].map((k) => (
            <Knob key={k} label={k.toUpperCase()} step={0.5} value={light[k]} onChange={(v) => setL(k, v)} />
          ))}

          <div style={s.section}>Flowers</div>
          {['Kiri', 'Tengah', 'Kanan'].map((name, i) => (
            <FlowerPanel key={i} label={name} transform={transforms[i]} onChange={(next) => setTransform(i, next)} />
          ))}
        </div>

        <button onClick={rebake} disabled={bakeTriggered && !done} style={s.actionBtn}>
          {!bakeTriggered ? '▶ Bake shadow' : done ? '⟳ Rebake' : `baking… ${progress}%`}
        </button>
        {done && (
          <button onClick={exportShadow} style={{ ...s.actionBtn, marginTop: 4, borderColor: '#4ade80', color: '#4ade80' }}>
            ↓ Export scene_shadow.json
          </button>
        )}
      </div>
    </div>
  );
}

const s = {
  panel: {
    position: 'absolute', top: 16, right: 16,
    background: 'rgba(6,10,18,0.88)', border: '1px solid #2a2a3a',
    borderRadius: 10, padding: '12px 14px', color: '#fff',
    fontFamily: 'monospace', fontSize: 12, width: 200, backdropFilter: 'blur(12px)',
    display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 32px)',
  },
  scroll: {
    overflowY: 'auto', flex: 1,
  },
  title:    { fontWeight: 700, fontSize: 11, letterSpacing: 2, color: '#7c3aed', marginBottom: 6 },
  section:  { color: '#555', fontSize: 10, letterSpacing: 1, margin: '8px 0 3px' },
  row:      { display: 'flex', alignItems: 'center', gap: 5 },
  knobLabel:{ color: '#888', fontSize: 9, letterSpacing: 0.5, marginBottom: 2 },
  arrow: {
    background: '#1a1a2e', border: '1px solid #333', borderRadius: 3,
    color: '#aaa', cursor: 'pointer', fontSize: 8, padding: '2px 5px',
    lineHeight: 1, userSelect: 'none',
  },
  numInput: {
    flex: 1, background: '#111', border: '1px solid #333', borderRadius: 3,
    color: '#ddd', fontFamily: 'monospace', fontSize: 11,
    textAlign: 'center', padding: '1px 3px', minWidth: 0,
  },
  actionBtn: {
    width: '100%', padding: '5px 0', marginTop: 2,
    background: '#1a1a2e', border: '1px solid #7c3aed', borderRadius: 4,
    color: '#c4b5fd', fontFamily: 'monospace', fontSize: 10,
    cursor: 'pointer', letterSpacing: 0.5,
  },
};
