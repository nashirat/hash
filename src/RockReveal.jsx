import { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { bakeShadowWithWorker, downloadShadowJson } from './shadowBakerUtils.js';

useGLTF.preload('/Kiri.glb');
useGLTF.preload('/Tengah.glb');
useGLTF.preload('/Kanan.glb');

const DEG = Math.PI / 180;

function FlowerModel({ file, position, rotation, scale, meshOnlyBounds = false, phaseOffset = 0, swayAmp = 1, swaySpeed = 1, shadowJson }) {
  const { scene } = useGLTF(file);
  const centeredScene = useMemo(() => scene.clone(), [scene]);
  const swayBaseRef = useRef();
  const swayMidRef = useRef();
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    const box = new THREE.Box3();
    if (meshOnlyBounds) {
      centeredScene.traverse((child) => { if (child.isMesh) box.expandByObject(child); });
      if (box.isEmpty()) box.setFromObject(centeredScene);
    } else {
      box.setFromObject(centeredScene);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const s = 2 / Math.max(size.x, size.y, size.z);
    centeredScene.scale.setScalar(s);
    centeredScene.position.set(-center.x * s, -center.y * s, -center.z * s);
    setBottomOffset((size.y * s) / 2);

    if (shadowJson) {
      fetch(shadowJson)
        .then((r) => r.json())
        .then((data) => {
          const byName = Object.fromEntries(data.meshes.map((m) => [m.name, m]));
          centeredScene.traverse((child) => {
            if (!child.isMesh) return;
            const entry = byName[child.name];
            if (!entry) return;
            child.geometry.setAttribute(
              'shadowFactor',
              new THREE.BufferAttribute(new Float32Array(entry.shadowValues), 1),
            );
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if (!mat) return;
              mat.onBeforeCompile = (shader) => {
                shader.vertexShader = 'attribute float shadowFactor;\nvarying float vShadowFactor;\n' +
                  shader.vertexShader.replace('void main() {', 'void main() {\n  vShadowFactor = shadowFactor;');
                shader.fragmentShader = 'varying float vShadowFactor;\n' +
                  shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    '#include <map_fragment>\n  diffuseColor.rgb *= vShadowFactor;',
                  );
              };
              mat.needsUpdate = true;
            });
          });
        });
    }
  }, [centeredScene, meshOnlyBounds]);


  useFrame(({ clock }) => {
    if (!swayBaseRef.current || !swayMidRef.current) return;
    const t = clock.getElapsedTime();
    const angle = (Math.sin(t * 1.0 * swaySpeed + phaseOffset) * 0.008
                + Math.sin(t * 1.8 * swaySpeed + phaseOffset * 0.7) * 0.003) * swayAmp;
    swayBaseRef.current.rotation.z = angle * 0.3;
    swayMidRef.current.rotation.z = angle * 0.7;
  });

  return (
    <group
      position={position}
      rotation={[rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG]}
      scale={scale}
    >
      <group position={[0, -bottomOffset, 0]} ref={swayBaseRef}>
        <group position={[0, bottomOffset, 0]}>
          <group ref={swayMidRef}>
            <primitive object={centeredScene} />
          </group>
        </group>
      </group>
    </group>
  );
}

// ─── flower config ────────────────────────────────────────────────────────────

const FLOWERS = [
  { file: '/Kiri.glb',   label: 'Kiri'   },
  { file: '/Tengah.glb', label: 'Tengah' },
  { file: '/Kanan.glb',  label: 'Kanan'  },
];

const DEFAULT_TRANSFORMS = [
  { pos: [-3.7, 2.4, -1.1], rot: [7, -3, -21],    scale: 0.7, swayAmp: 1.0, swaySpeed: 1.0 },
  { pos: [-0.5, 0,   -0.9], rot: [0, -21, 0],      scale: 1.3, swayAmp: 0.5, swaySpeed: 0.6 },
  { pos: [5.8,  1.2, -1.1], rot: [-16, 345, -135], scale: 4.5, swayAmp: 1.0, swaySpeed: 1.0 },
];

function defaultTransform(i) {
  return { ...DEFAULT_TRANSFORMS[i], pos: [...DEFAULT_TRANSFORMS[i].pos], rot: [...DEFAULT_TRANSFORMS[i].rot] };
}

// ─── control panel ────────────────────────────────────────────────────────────

function Knob({ label, step, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const commit = (raw) => { const n = parseFloat(raw); setDraft(null); if (!isNaN(n)) onChange(n); };
  const nudge = (dir) => onChange(parseFloat((value + dir * step).toFixed(10)));
  return (
    <div style={s.row}>
      <span style={s.axis}>{label}</span>
      <button style={s.arrow} onClick={() => nudge(-1)}>▼</button>
      <input
        type="text"
        value={draft ?? Number(value).toFixed(4)}
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
  );
}

function FlowerPanel({ idx, label, transform, onChange }) {
  const set = (key, subIdx, val) => {
    const next = { ...transform };
    if (subIdx !== null) { const arr = [...next[key]]; arr[subIdx] = val; next[key] = arr; }
    else { next[key] = val; }
    onChange(idx, next);
  };
  const [open, setOpen] = useState(true);
  return (
    <div style={s.group}>
      <div style={s.groupHeader} onClick={() => setOpen((o) => !o)}>
        <span style={s.label}>{label}</span>
        <span style={{ color: '#666', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <div style={s.sectionLabel}>Position</div>
          {['X', 'Y', 'Z'].map((ax, ai) => (
            <Knob key={ax} label={ax} step={0.1} value={transform.pos[ai]} onChange={(v) => set('pos', ai, v)} />
          ))}
          <div style={s.sectionLabel}>Rotation (°)</div>
          {['X', 'Y', 'Z'].map((ax, ai) => (
            <Knob key={ax} label={ax} step={1} value={transform.rot[ai]} onChange={(v) => set('rot', ai, v)} />
          ))}
          <div style={s.sectionLabel}>Scale</div>
          <Knob label="S" step={0.1} value={transform.scale} onChange={(v) => set('scale', null, v)} />
          <div style={s.sectionLabel}>Sway</div>
          <Knob label="A" step={0.1} value={transform.swayAmp}   onChange={(v) => set('swayAmp',   null, v)} />
          <Knob label="S" step={0.1} value={transform.swaySpeed} onChange={(v) => set('swaySpeed', null, v)} />
        </>
      )}
    </div>
  );
}

function BakePanel({
  bakeLight, setBakeL,
  bakeStrength, setBakeStrength,
  bakeDist, setBakeDist,
  bakePasses, setBakePasses,
  bakeAoOnly, setBakeAoOnly,
  bakeAoRays, setBakeAoRays,
  bakeAoStr, setBakeAoStr,
  bakeAoMax, setBakeAoMax,
  bakeActive, bakeProgress, bakeDone,
  onBake, onExport,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={s.group}>
      <div style={s.groupHeader} onClick={() => setOpen((o) => !o)}>
        <span style={s.label}>Bake Shadow</span>
        <span style={{ color: bakeDone ? '#4ade80' : bakeActive ? '#f59e0b' : '#555', fontSize: 10 }}>
          {bakeDone ? '✓' : bakeActive ? `${bakeProgress}%` : open ? '▲' : '▼'}
        </span>
      </div>
      {open && (
        <>
          <div style={{ ...s.row, marginBottom: 6 }}>
            <input type="checkbox" id="aoOnly" checked={bakeAoOnly} onChange={(e) => setBakeAoOnly(e.target.checked)} style={{ accentColor: '#7c3aed' }} />
            <label htmlFor="aoOnly" style={{ color: '#c4b5fd', fontSize: 10, cursor: 'pointer' }}>AO only (no directional)</label>
          </div>
          {!bakeAoOnly && (
            <>
              <div style={s.sectionLabel}>Light Position</div>
              {['x', 'y', 'z'].map((k) => (
                <Knob key={k} label={k.toUpperCase()} step={0.5} value={bakeLight[k]} onChange={(v) => setBakeL(k, v)} />
              ))}
              <div style={s.sectionLabel}>Shadow</div>
              <Knob label="Strength" step={0.05} value={bakeStrength} onChange={setBakeStrength} />
              <Knob label="Distance" step={0.5}  value={bakeDist}     onChange={setBakeDist} />
            </>
          )}
          <div style={s.sectionLabel}>AO</div>
          <Knob label="Rays"     step={1}    value={bakeAoRays}   onChange={(v) => setBakeAoRays(Math.max(0, Math.round(v)))} />
          <Knob label="Strength" step={0.05} value={bakeAoStr}    onChange={setBakeAoStr} />
          <Knob label="Distance" step={0.5}  value={bakeAoMax}    onChange={setBakeAoMax} />
          <Knob label="Blur"     step={1}    value={bakePasses}   onChange={(v) => setBakePasses(Math.max(0, Math.round(v)))} />
          <button
            onClick={onBake}
            disabled={bakeActive}
            style={{ ...s.exportBtn, marginTop: 8, background: '#1a1a2e', border: '1px solid #7c3aed', color: '#c4b5fd' }}
          >
            {bakeActive ? `baking… ${bakeProgress}%` : bakeDone ? '⟳ Rebake' : '▶ Bake'}
          </button>
          {bakeDone && (
            <button
              onClick={onExport}
              style={{ ...s.exportBtn, marginTop: 4, background: '#1a1a2e', border: '1px solid #4ade80', color: '#4ade80' }}
            >
              ↓ Export scene_shadow.json
            </button>
          )}
        </>
      )}
    </div>
  );
}

function BakeTrigger({ groupRef, bakeKey, triggered, shadowParams, onProgress, onDone }) {
  useEffect(() => {
    if (!triggered || !groupRef.current) return;
    bakeShadowWithWorker(groupRef.current, shadowParams, onProgress)
      .then(onDone)
      .catch(console.error);
  }, [bakeKey]);
  return null;
}

function PanRig({ offset, orbitRef }) {
  useEffect(() => {
    if (!orbitRef.current) return;
    orbitRef.current.target.set(offset[0], offset[1], offset[2]);
    orbitRef.current.update();
  }, [offset]);
  return null;
}

// ─── export ───────────────────────────────────────────────────────────────────

function exportConfig(transforms, camPos) {
  return JSON.stringify({
    camera: camPos.map((v) => parseFloat(v.toFixed(3))),
    flowers: FLOWERS.map((f, i) => ({
      file: f.file,
      label: f.label,
      position: transforms[i].pos.map((v) => parseFloat(v.toFixed(3))),
      rotation: transforms[i].rot.map((v) => parseFloat(v.toFixed(1))),
      scale: parseFloat(transforms[i].scale.toFixed(3)),
      swayAmp: parseFloat(transforms[i].swayAmp.toFixed(2)),
      swaySpeed: parseFloat(transforms[i].swaySpeed.toFixed(2)),
    })),
  }, null, 2);
}

// ─── root ─────────────────────────────────────────────────────────────────────

export default function RockReveal() {
  const [transforms, setTransforms] = useState(() => FLOWERS.map((_, i) => defaultTransform(i)));
  const [camOffset, setCamOffset] = useState([0, 1.7, 0]);

  const flowerGroupRef = useRef();
  const bakeExportRef  = useRef(null);
  const orbitRef       = useRef();
  const [bakeLight, setBakeLight]     = useState({ x: 0, y: 0, z: 10 });
  const setBakeL = (k, v) => setBakeLight((p) => ({ ...p, [k]: v }));
  const [bakeStrength, setBakeStrength] = useState(1.0);
  const [bakeDist,     setBakeDist]     = useState(50);
  const [bakePasses,   setBakePasses]   = useState(5);
  const [bakeAoOnly,   setBakeAoOnly]   = useState(true);
  const [bakeAoRays,   setBakeAoRays]   = useState(32);
  const [bakeAoStr,    setBakeAoStr]    = useState(0.6);
  const [bakeAoMax,    setBakeAoMax]    = useState(1.5);
  const [bakeKey,      setBakeKey]      = useState(0);
  const [bakeActive,   setBakeActive]   = useState(false);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeDone,     setBakeDone]     = useState(false);

  const shadowParams = {
    lx: bakeLight.x, ly: bakeLight.y, lz: bakeLight.z,
    dist: bakeDist, strength: bakeStrength,
    smoothPasses: bakePasses,
    aoRays: bakeAoRays, aoStrength: bakeAoStr, aoMaxDist: bakeAoMax,
    aoOnly: bakeAoOnly,
  };

  const triggerBake = () => {
    setBakeDone(false);
    setBakeProgress(0);
    setBakeActive(true);
    setBakeKey((k) => k + 1);
  };

  const handleBakeDone = (data) => {
    bakeExportRef.current = data;
    setBakeDone(true);
    setBakeActive(false);
  };
  const [ambientIntensity, setAmbientIntensity] = useState(1.0);
  const [showAxes, setShowAxes] = useState(true);
  const [copied, setCopied] = useState(false);
  const [panelPos, setPanelPos] = useState({ x: 16, y: 16 });
  const dragRef = useRef(null);


  const [grade, setGrade] = useState({
    exposure: 1.0,
    saturation: 0.1,
    hue: 0,
    brightness: 0,
    contrast: 0.05,
  });
  const setGradeKey = (key, val) => setGrade((p) => ({ ...p, [key]: val }));



  const onDragStart = (e) => {
    dragRef.current = { startX: e.clientX - panelPos.x, startY: e.clientY - panelPos.y };
    const onMove = (e) => setPanelPos({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleChange = (idx, next) => setTransforms((prev) => prev.map((t, i) => (i === idx ? next : t)));

  const handleExport = () => {
    const json = exportConfig(transforms, camOffset);
    navigator.clipboard.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0, 10], fov: 34 }}
        gl={{ antialias: true }}
        style={{ background: '#000000' }}
      >
        <ambientLight intensity={ambientIntensity} />
        {showAxes && <axesHelper args={[5]} />}
        <PanRig offset={camOffset} orbitRef={orbitRef} />
        <OrbitControls ref={orbitRef} enableZoom={false} enableDamping dampingFactor={0.05} />
        <group ref={flowerGroupRef}>
          {FLOWERS.map((f, i) => (
            <FlowerModel
              key={f.file}
              file={f.file}
              position={transforms[i].pos}
              rotation={transforms[i].rot}
              scale={transforms[i].scale}
              meshOnlyBounds={f.file === '/Kanan.glb'}
              phaseOffset={i * 2.1}
              swayAmp={transforms[i].swayAmp}
              swaySpeed={transforms[i].swaySpeed}
              shadowJson={f.shadowJson}
            />
          ))}
        </group>
        <BakeTrigger
          groupRef={flowerGroupRef}
          bakeKey={bakeKey}
          triggered={bakeActive}
          shadowParams={shadowParams}
          onProgress={setBakeProgress}
          onDone={handleBakeDone}
        />
      </Canvas>

      <div style={{ ...s.panel, left: panelPos.x, top: panelPos.y, right: 'unset' }}>
        <div style={s.titleBar} onMouseDown={onDragStart}>
          <span style={s.title}>FLOWER CONTROLS</span>
          <span style={{ color: '#444', fontSize: 10 }}>⠿</span>
        </div>

        <div style={s.scroll}>
          <div style={s.group}>
            <div style={s.groupHeader}><span style={s.label}>Scene</span></div>
            <div style={s.sectionLabel}>Ambient</div>
            <Knob label="I" step={0.05} value={ambientIntensity} onChange={setAmbientIntensity} />
            <div style={{ ...s.row, marginTop: 6 }}>
              <input type="checkbox" id="axes" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} style={{ accentColor: '#7c3aed' }} />
              <label htmlFor="axes" style={{ color: '#666', fontSize: 10, cursor: 'pointer' }}>Axes guide</label>
            </div>
            <div style={s.sectionLabel}>Camera Pan</div>
            {['X', 'Y', 'Z'].map((ax, ai) => (
              <Knob key={ax} label={ax} step={0.1}
                value={camOffset[ai]}
                onChange={(v) => setCamOffset((p) => { const n = [...p]; n[ai] = v; return n; })}
              />
            ))}
          </div>

{FLOWERS.map((f, i) => (
            <FlowerPanel key={i} idx={i} label={f.label} transform={transforms[i]} onChange={handleChange} />
          ))}

<div style={s.group}>
            <div style={s.groupHeader}><span style={s.label}>Color Grade</span></div>
            <div style={s.sectionLabel}>Exposure</div>
            <Knob label="E" step={0.05} value={grade.exposure}    onChange={(v) => setGradeKey('exposure', v)} />
            <div style={s.sectionLabel}>Hue / Sat</div>
            <Knob label="H" step={0.01} value={grade.hue}        onChange={(v) => setGradeKey('hue', v)} />
            <Knob label="S" step={0.05} value={grade.saturation} onChange={(v) => setGradeKey('saturation', v)} />
            <div style={s.sectionLabel}>Brightness / Contrast</div>
            <Knob label="B" step={0.02} value={grade.brightness} onChange={(v) => setGradeKey('brightness', v)} />
            <Knob label="C" step={0.02} value={grade.contrast}   onChange={(v) => setGradeKey('contrast', v)} />
          </div>

          <BakePanel
            bakeLight={bakeLight} setBakeL={setBakeL}
            bakeStrength={bakeStrength} setBakeStrength={setBakeStrength}
            bakeDist={bakeDist} setBakeDist={setBakeDist}
            bakePasses={bakePasses} setBakePasses={setBakePasses}
            bakeAoOnly={bakeAoOnly} setBakeAoOnly={setBakeAoOnly}
            bakeAoRays={bakeAoRays} setBakeAoRays={setBakeAoRays}
            bakeAoStr={bakeAoStr} setBakeAoStr={setBakeAoStr}
            bakeAoMax={bakeAoMax} setBakeAoMax={setBakeAoMax}
            bakeActive={bakeActive} bakeProgress={bakeProgress} bakeDone={bakeDone}
            onBake={triggerBake}
            onExport={() => bakeExportRef.current && downloadShadowJson(bakeExportRef.current)}
          />
        </div>

        <button onClick={handleExport} style={s.exportBtn}>
          {copied ? '✓ Copied!' : 'Export JSON'}
        </button>
      </div>
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = {
  panel: {
    position: 'absolute',
    background: 'rgba(6,10,18,0.85)',
    border: '1px solid #2a2a3a',
    borderRadius: 10,
    padding: '12px 14px',
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: 12,
    width: 230,
    backdropFilter: 'blur(12px)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100vh - 32px)',
  },
  titleBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    cursor: 'grab', marginBottom: 10, userSelect: 'none',
  },
  title: { fontWeight: 700, fontSize: 11, letterSpacing: 2, color: '#7c3aed' },
  scroll: { overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' },
  group: { marginBottom: 10, borderBottom: '1px solid #1e1e2e', paddingBottom: 8 },
  groupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: 6 },
  label: { color: '#c4b5fd', fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  sectionLabel: { color: '#555', fontSize: 10, letterSpacing: 1, margin: '5px 0 2px' },
  row: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 },
  axis: { width: 14, color: '#666', fontSize: 10, textAlign: 'right' },
  arrow: {
    background: '#1a1a2e', border: '1px solid #333', borderRadius: 3,
    color: '#aaa', cursor: 'pointer', fontSize: 8, padding: '2px 5px',
    lineHeight: 1, userSelect: 'none',
  },
  numInput: {
    flex: 1, background: '#111', border: '1px solid #333',
    borderRadius: 3, color: '#ddd', fontFamily: 'monospace',
    fontSize: 11, textAlign: 'center', padding: '1px 3px', minWidth: 0,
  },
  exportBtn: {
    marginTop: 10, background: '#7c3aed', border: 'none', borderRadius: 6,
    color: '#fff', fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
    padding: '8px 0', cursor: 'pointer', letterSpacing: 1, width: '100%',
  },
};
