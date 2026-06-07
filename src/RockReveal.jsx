import { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { EffectComposer, SMAA, Vignette, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

useGLTF.preload('/Kiri.glb');
useGLTF.preload('/Tengah.glb');
useGLTF.preload('/Kanan.glb');

const DEG = Math.PI / 180;

function FlowerModel({ file, position, rotation, scale, meshOnlyBounds = false, phaseOffset = 0, swayAmp = 1, swaySpeed = 1, matSettings }) {
  const { scene } = useGLTF(file);
  const centeredScene = useMemo(() => scene.clone(), [scene]);
  const swayBaseRef = useRef();
  const swayMidRef = useRef();
  const matRefsRef = useRef([]);
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

    // upgrade materials to MeshPhysicalMaterial for sheen + iridescence support
    const upgraded = [];
    centeredScene.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const upgradedMats = mats.map((src) => {
        if (!src || src.isMeshPhysicalMaterial) { upgraded.push(src); return src; }
        const phys = new THREE.MeshPhysicalMaterial({
          color: src.color?.clone() ?? new THREE.Color(1, 1, 1),
          map: src.map ?? null,
          normalMap: src.normalMap ?? null,
          normalScale: src.normalScale?.clone() ?? new THREE.Vector2(1, 1),
          roughnessMap: src.roughnessMap ?? null,
          metalnessMap: src.metalnessMap ?? null,
          aoMap: src.aoMap ?? null,
          emissive: src.emissive?.clone() ?? new THREE.Color(0, 0, 0),
          emissiveMap: src.emissiveMap ?? null,
          emissiveIntensity: src.emissiveIntensity ?? 1,
          roughness: src.roughness ?? 1,
          metalness: src.metalness ?? 0,
          transparent: src.transparent ?? false,
          opacity: src.opacity ?? 1,
          alphaMap: src.alphaMap ?? null,
          alphaTest: src.alphaTest ?? 0,
          side: src.side ?? THREE.FrontSide,
        });
        upgraded.push(phys);
        return phys;
      });
      child.material = Array.isArray(child.material) ? upgradedMats : upgradedMats[0];
    });
    matRefsRef.current = upgraded;
  }, [centeredScene, meshOnlyBounds]);

  // update physical properties when matSettings changes without recreating materials
  useEffect(() => {
    if (!matSettings) return;
    matRefsRef.current.forEach((mat) => {
      if (!mat) return;
      mat.sheen = matSettings.sheen;
      mat.sheenRoughness = matSettings.sheenRoughness;
      mat.sheenColor.set(0xffffff);
      mat.iridescence = matSettings.iridescence;
      mat.iridescenceIOR = 1.4;
      mat.needsUpdate = true;
    });
  }, [matSettings]);

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
  { pos: [-3.4, 1, 0],    rot: [7, -3, -21],    scale: 0.6, swayAmp: 1.0, swaySpeed: 1.0 },
  { pos: [-0.5, -1.5, 0], rot: [0, -21, 0],      scale: 1.2, swayAmp: 0.5, swaySpeed: 0.7 },
  { pos: [5.3, -0.8, 0],  rot: [-16, 345, -135], scale: 4.5, swayAmp: 1.0, swaySpeed: 1.0 },
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

function CameraRig({ position }) {
  const { camera } = useThree();
  useEffect(() => { camera.position.set(...position); }, [camera, position]);
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
  const [camPos, setCamPos] = useState([0, 0, 10]);
  const [ambientIntensity, setAmbientIntensity] = useState(2.2);
  const [copied, setCopied] = useState(false);
  const [panelPos, setPanelPos] = useState({ x: 16, y: 16 });
  const dragRef = useRef(null);

  const [pfx, setPfx] = useState({
    vignetteDark: 0.5,
    vignetteOffset: 0.3,
    bloom: 0.2,
    bloomThreshold: 0.8,
  });
  const setPfxKey = (key, val) => setPfx((p) => ({ ...p, [key]: val }));

  const [matSettings, setMatSettings] = useState({
    sheen: 0.3,
    sheenRoughness: 0.5,
    iridescence: 0.15,
  });
  const setMatKey = (key, val) => setMatSettings((p) => ({ ...p, [key]: val }));

  const onDragStart = (e) => {
    dragRef.current = { startX: e.clientX - panelPos.x, startY: e.clientY - panelPos.y };
    const onMove = (e) => setPanelPos({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleChange = (idx, next) => setTransforms((prev) => prev.map((t, i) => (i === idx ? next : t)));

  const handleExport = () => {
    const json = exportConfig(transforms, camPos);
    navigator.clipboard.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0, 10], fov: 34 }}
        gl={{ antialias: false }}
        style={{ background: '#000000' }}
      >
        <ambientLight intensity={ambientIntensity} />
        <CameraRig position={camPos} />
        <OrbitControls enableRotate={false} enableDamping dampingFactor={0.05} />
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
            matSettings={matSettings}
          />
        ))}
        <EffectComposer>
          <SMAA />
          <Vignette darkness={pfx.vignetteDark} offset={pfx.vignetteOffset} />
          <Bloom intensity={pfx.bloom} luminanceThreshold={pfx.bloomThreshold} luminanceSmoothing={0.3} />
        </EffectComposer>
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
            <div style={s.sectionLabel}>Camera</div>
            {['X', 'Y', 'Z'].map((ax, ai) => (
              <Knob key={ax} label={ax} step={0.1}
                value={camPos[ai]}
                onChange={(v) => setCamPos((p) => { const n = [...p]; n[ai] = v; return n; })}
              />
            ))}
          </div>

          {FLOWERS.map((f, i) => (
            <FlowerPanel key={i} idx={i} label={f.label} transform={transforms[i]} onChange={handleChange} />
          ))}

          <div style={s.group}>
            <div style={s.groupHeader}><span style={s.label}>Material</span></div>
            <div style={s.sectionLabel}>Sheen</div>
            <Knob label="I" step={0.05} value={matSettings.sheen}         onChange={(v) => setMatKey('sheen', v)} />
            <Knob label="R" step={0.05} value={matSettings.sheenRoughness} onChange={(v) => setMatKey('sheenRoughness', v)} />
            <div style={s.sectionLabel}>Iridescence</div>
            <Knob label="I" step={0.05} value={matSettings.iridescence}   onChange={(v) => setMatKey('iridescence', v)} />
          </div>

          <div style={s.group}>
            <div style={s.groupHeader}><span style={s.label}>Post FX</span></div>
            <div style={s.sectionLabel}>Vignette</div>
            <Knob label="D" step={0.05} value={pfx.vignetteDark}   onChange={(v) => setPfxKey('vignetteDark', v)} />
            <Knob label="O" step={0.05} value={pfx.vignetteOffset} onChange={(v) => setPfxKey('vignetteOffset', v)} />
            <div style={s.sectionLabel}>Bloom</div>
            <Knob label="I" step={0.05} value={pfx.bloom}          onChange={(v) => setPfxKey('bloom', v)} />
            <Knob label="T" step={0.05} value={pfx.bloomThreshold} onChange={(v) => setPfxKey('bloomThreshold', v)} />
          </div>
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
