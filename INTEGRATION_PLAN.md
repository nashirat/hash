# 3D Scene → UI Repo Integration Plan

## Context

We are integrating a R3F 3D flower scene (from `hashgraph/`) into the UI landing page repo (`ui-repo/`). The UI repo is the **target** — all work happens inside it.

The scene sits **fullscreen behind** the UI (fixed, z-0). The UI (topbar, bottombar, text, preloader) sits **on top** (z-10+).

---

## Step 1 — Install missing packages

UI repo already has: `@react-three/fiber`, `@react-three/drei`, `leva`, `three`

Add what's missing:

```bash
npm install @react-three/postprocessing postprocessing draco3d
```

> `postprocessing` — custom GLSL color grade effect  
> `@react-three/postprocessing` — EffectComposer, SMAA wrappers  
> `draco3d` — for draco-compressed GLB decoding (kiri.glb, kanan.glb)

---

## Step 2 — Copy GLB assets

Copy these 3 files from `hashgraph/public/` into `ui-repo/public/`:

- `fullcomp.glb`
- `kiri.glb`
- `kanan.glb`

```bash
cp hashgraph/public/fullcomp.glb ui-repo/public/
cp hashgraph/public/kiri.glb     ui-repo/public/
cp hashgraph/public/kanan.glb    ui-repo/public/
```

---

## Step 3 — Create the scene file

Create `ui-repo/src/Scene3D.tsx` with the content below.

> Named `Scene3D` to avoid collision with existing `ui-repo/src/Scene.tsx`.  
> `// @ts-nocheck` at top — file is JS-style, no type annotations needed yet.

```tsx
// @ts-nocheck
import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { EffectComposer, SMAA } from '@react-three/postprocessing';
import { Effect } from 'postprocessing';
import { Uniform } from 'three';
import { useControls, folder } from 'leva';
import * as THREE from 'three';

// ── Sway Update (inside Canvas) ───────────────────────────────────────────────
function SwayUpdate({ swayRef, windAmp, windSpeed }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * windSpeed * 0.35;
    const wind = (
      Math.sin(t) +
      Math.sin(t * 1.37 + 1.5) * 0.22 +
      Math.sin(t * 2.71 + 3.1) * 0.06
    ) * windAmp;
    const mod = Math.sin(t * 0.18) * 0.15 + 0.85;
    swayRef.current.x.value = wind * mod;
    swayRef.current.z.value = Math.sin(t * 0.79 + 0.9) * windAmp * 0.08 * mod;
  });
  return null;
}

// ── Color Grade Effect ────────────────────────────────────────────────────────
class ColorGradeImpl extends Effect {
  constructor() {
    super('ColorGrade', /* glsl */`
      uniform float uExposure;
      uniform float uSaturation;
      uniform float uBrightness;
      uniform float uContrast;

      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * uExposure;
        c += uBrightness;
        c = (c - 0.5) * (1.0 + uContrast) + 0.5;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(lum), c, uSaturation);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }
    `, {
      uniforms: new Map([
        ['uExposure',   new Uniform(1.0)],
        ['uSaturation', new Uniform(1.0)],
        ['uBrightness', new Uniform(0.0)],
        ['uContrast',   new Uniform(0.0)],
      ]),
    });
  }
}

function ColorGradePass({ exposure, saturation, brightness, contrast }) {
  const effect = useMemo(() => new ColorGradeImpl(), []);
  useEffect(() => { effect.uniforms.get('uExposure').value   = exposure;   }, [effect, exposure]);
  useEffect(() => { effect.uniforms.get('uSaturation').value = saturation; }, [effect, saturation]);
  useEffect(() => { effect.uniforms.get('uBrightness').value = brightness; }, [effect, brightness]);
  useEffect(() => { effect.uniforms.get('uContrast').value   = contrast;   }, [effect, contrast]);
  return <primitive object={effect} dispose={null} />;
}

function CameraFov({ fov }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [fov, camera]);
  return null;
}

function ToneMappingSetup({ type }) {
  const { gl } = useThree();
  useEffect(() => { gl.toneMapping = type; }, [type, gl]);
  return null;
}

useGLTF.preload('/fullcomp.glb');
useGLTF.preload('/kiri.glb');
useGLTF.preload('/kanan.glb');

const MODEL_IDX    = 0;
const DIRLIGHT_IDX = 1;
const KIRI_IDX     = 2;
const KANAN_IDX    = 3;

// ── Model ─────────────────────────────────────────────────────────────────────
function Model({ position, rotation, selected, onSelect, groupRef, anisotropy,
                 roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness,
                 swayRef, glbPath, meshMultMap }) {
  const { scene } = useGLTF(glbPath);
  const { gl } = useThree();
  const ready = useRef(false);
  const texturesRef = useRef([]);
  const matsRef = useRef([]);

  useEffect(() => {
    if (ready.current) return;
    ready.current = true;

    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.sub(center);
    scene.updateMatrixWorld(true);

    const worldPivot = new THREE.Vector3(0, box.min.y - center.y, 0);

    const seen = new Set();
    const textures = [];
    const mats = [];
    scene.traverse((c) => {
      if (!c.isMesh) return;
      c.castShadow = true;
      c.receiveShadow = true;
      if (!c.material._owned) { c.material = c.material.clone(); c.material._owned = true; }
      mats.push(c.material);
      Object.values(c.material).forEach((v) => {
        if (v?.isTexture && !seen.has(v.uuid)) {
          seen.add(v.uuid);
          textures.push(v);
        }
      });

      const localPivot = c.worldToLocal(worldPivot.clone());
      const partKey = meshMultMap?.[c.name] ?? 'flower';
      const multRef = partKey === 'branch' ? swayRef.current.branchMult : swayRef.current.flowerMult;

      const mat = c.material;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uSwayX    = swayRef.current.x;
        shader.uniforms.uSwayZ    = swayRef.current.z;
        shader.uniforms.uSwayMult = multRef;
        shader.uniforms.uSwayPivot = { value: localPivot };
        shader.vertexShader =
          `uniform float uSwayX;\nuniform float uSwayZ;\nuniform float uSwayMult;\nuniform vec3 uSwayPivot;\n`
          + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `float _angle = length(vec2(uSwayX, uSwayZ)) * uSwayMult;
vec3 _axis = (_angle > 0.0001) ? normalize(vec3(-uSwayZ, 0.0, uSwayX)) : vec3(0.0, 0.0, 1.0);
vec3 _rel = position - uSwayPivot;
float _c = cos(_angle); float _s = sin(_angle);
vec3 transformed = _rel * _c + cross(_axis, _rel) * _s + _axis * dot(_axis, _rel) * (1.0 - _c) + uSwayPivot;`
          );
      };
      mat.needsUpdate = true;
    });
    texturesRef.current = textures;
    matsRef.current = mats;
  }, [scene, gl, swayRef]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    const clamped = Math.min(anisotropy, maxAniso);
    texturesRef.current.forEach((t) => { t.anisotropy = clamped; t.needsUpdate = true; });
  }, [anisotropy, gl]);

  useEffect(() => { matsRef.current.forEach(m => { m.roughness          = roughness;          }); }, [roughness]);
  useEffect(() => { matsRef.current.forEach(m => { m.metalness          = metalness;          }); }, [metalness]);
  useEffect(() => { matsRef.current.forEach(m => { if ('clearcoat'          in m) m.clearcoat          = clearcoat;         }); }, [clearcoat]);
  useEffect(() => { matsRef.current.forEach(m => { if ('clearcoatRoughness' in m) m.clearcoatRoughness = clearcoatRoughness; }); }, [clearcoatRoughness]);
  useEffect(() => { matsRef.current.forEach(m => { if ('sheen'              in m) m.sheen              = sheen;             }); }, [sheen]);
  useEffect(() => { matsRef.current.forEach(m => { if ('sheenRoughness'     in m) m.sheenRoughness     = sheenRoughness;    }); }, [sheenRoughness]);

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <primitive object={scene} />
    </group>
  );
}

// ── Directional Light (grabbable) ────────────────────────────────────────────
function DirLight({ groupRef, position, color, intensity, shadowIntensity,
                    shadowRes, target,
                    selected, onSelect }) {
  return (
    <group ref={groupRef} position={position}>
      <directionalLight
        color={color}
        intensity={intensity}
        castShadow
        shadow-intensity={shadowIntensity}
        shadow-mapSize={[shadowRes, shadowRes]}
        shadow-bias={-0.0005}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        target-position={[target?.x ?? 0, target?.y ?? 0, target?.z ?? 0]}
      />
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={selected ? '#ffffff' : '#ffe566'} depthTest={false} />
      </mesh>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

// ── Main Scene ────────────────────────────────────────────────────────────────
export default function Scene3D() {
  const [positions, setPositions] = useState([
    [0.09948271227865446, -0.7613390885327538, 0],                        // fullcomp
    [1.5494332350434508, -0.7042463700944723, 1.2594799824242129],        // dirlight
    [-4.2275190627220915, 0.24783553448404338, 0],                        // kiri
    [10.694104321521328, -0.5273063106846092, -11.367553468085417],       // kanan
  ]);
  const [rotations, setRotations] = useState([
    [0, -0.2446801252098483, 0],                                          // fullcomp
    [0.013708394273127152, 0.06546152696165551, -0.1897699151722256],     // kiri
    [0, -0.7040454240681647, 0],                                          // kanan
  ]);
  const [selected, setSelected] = useState(null);
  const [tcMode, setTcMode]     = useState('translate');

  const orbitRef      = useRef(null);
  const tcRef         = useRef(null);
  const modelRef      = useRef(null);
  const kiriRef       = useRef(null);
  const kananRef      = useRef(null);
  const dirLightRef   = useRef(null);
  const lastDragRef   = useRef(null);
  const swayRef       = useRef({ x: { value: 0 }, z: { value: 0 }, branchMult: { value: 1.0 }, flowerMult: { value: 0.6 } });

  const [{ toneMapping, exposure, saturation, brightness, contrast,
           fov, modelPos, modelRot, anisotropy,
           roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness,
           dlPos, dlIntensity, dlColor, dlShadow,
           dlTarget, shadowRes,
           hemiSky, hemiGround, hemiIntensity,
           tcModeVal,
           swayWind, swaySpeed, swayBranchMult, swayFlowerMult,
           kiriPos, kiriRot, kananPos, kananRot }, set] = useControls(() => ({
    Render: folder({
      toneMapping: { label: 'Tone Mapping', value: THREE.ACESFilmicToneMapping, options: {
        'ACES Filmic': THREE.ACESFilmicToneMapping,
        'AgX':         THREE.AgXToneMapping,
        'Neutral':     THREE.NeutralToneMapping,
        'Reinhard':    THREE.ReinhardToneMapping,
        'Cineon':      THREE.CineonToneMapping,
        'None':        THREE.LinearToneMapping,
      }},
      exposure:    { label: 'Exposure',    value: 2.62, min: 0,  max: 10, step: 0.01 },
      saturation:  { label: 'Saturation',  value: 1.18, min: 0,  max: 3,  step: 0.01 },
      brightness:  { label: 'Brightness',  value: 0,    min: -1, max: 1,  step: 0.01 },
      contrast:    { label: 'Contrast',    value: 0.01, min: -1, max: 1,  step: 0.01 },
    }),
    Model: folder({
      fov:                { label: 'FOV',               value: 45,  min: 10, max: 120, step: 1    },
      anisotropy:         { label: 'Anisotropy',        value: 16,  options: [1, 2, 4, 8, 16]    },
      roughness:          { label: 'Roughness',         value: 1,   min: 0, max: 1, step: 0.01  },
      metalness:          { label: 'Metalness',         value: 0,   min: 0, max: 1, step: 0.01  },
      clearcoat:          { label: 'Clearcoat',         value: 0,   min: 0, max: 1, step: 0.01  },
      clearcoatRoughness: { label: 'Clearcoat Rough',   value: 0.1, min: 0, max: 1, step: 0.01  },
      sheen:              { label: 'Sheen',             value: 0,   min: 0, max: 1, step: 0.01  },
      sheenRoughness:     { label: 'Sheen Roughness',   value: 0.5, min: 0, max: 1, step: 0.01  },
      modelPos: {
        label: 'Position', value: { x: 0.09948271227865446, y: -0.7613390885327538, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === MODEL_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      modelRot: {
        label: 'Rotation', value: { x: 0, y: -0.2446801252098483, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 0 ? [v.x, v.y, v.z] : rot));
        },
      },
    }),
    Kiri: folder({
      kiriPos: {
        label: 'Position', value: { x: -4.2275190627220915, y: 0.24783553448404338, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === KIRI_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      kiriRot: {
        label: 'Rotation', value: { x: 0.013708394273127152, y: 0.06546152696165551, z: -0.1897699151722256 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 1 ? [v.x, v.y, v.z] : rot));
        },
      },
    }),
    Kanan: folder({
      kananPos: {
        label: 'Position', value: { x: 10.694104321521328, y: -0.5273063106846092, z: -11.367553468085417 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === KANAN_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      kananRot: {
        label: 'Rotation', value: { x: 0, y: -0.7040454240681647, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 2 ? [v.x, v.y, v.z] : rot));
        },
      },
    }),
    'Dir Light': folder({
      dlPos: {
        label: 'Position', value: { x: 1.5494332350434508, y: -0.7042463700944723, z: 1.2594799824242129 }, step: 0.1,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === DIRLIGHT_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      dlIntensity: { label: 'Intensity',  value: 2,     min: 0, max: 20,   step: 0.1  },
      dlColor:     { label: 'Color',      value: '#ffffff'                              },
      dlShadow:    { label: 'Shadow',     value: 1,     min: 0, max: 1,    step: 0.01  },
      dlTarget:    { label: 'Target',     value: { x: 0, y: 0, z: 0 },    step: 0.1   },
      shadowRes:   { label: 'Shadow Res', value: 2048,  options: [512, 1024, 2048, 4096] },
    }),
    'Hemi Light': folder({
      hemiSky:       { label: 'Sky',       value: '#ffffff'                                },
      hemiGround:    { label: 'Ground',    value: '#000000'                                },
      hemiIntensity: { label: 'Intensity', value: 0.35,    min: 0, max: 5,   step: 0.01  },
    }),
    Transform: folder({
      tcModeVal: {
        label: 'Mode', value: 'translate', options: ['translate', 'rotate', 'scale'],
        onChange: (v, _, { initial }) => { if (!initial) setTcMode(v); },
      },
    }),
    Sway: folder({
      swayWind:       { label: 'Wind Amp',    value: 0.018, min: 0, max: 0.15, step: 0.001 },
      swaySpeed:      { label: 'Wind Speed',  value: 1.0,   min: 0, max: 4,    step: 0.01  },
      swayBranchMult: { label: 'Branch Mult', value: 1.0,   min: 0, max: 3,    step: 0.01  },
      swayFlowerMult: { label: 'Flower Mult', value: 0.6,   min: 0, max: 3,    step: 0.01  },
    }),
  }));

  useEffect(() => { swayRef.current.branchMult.value = swayBranchMult; }, [swayBranchMult]);
  useEffect(() => { swayRef.current.flowerMult.value = swayFlowerMult; }, [swayFlowerMult]);

  useEffect(() => {
    const onMid = (e) => { if (e.button === 1) { e.preventDefault(); orbitRef.current?.reset(); } };
    window.addEventListener('mousedown', onMid);
    return () => window.removeEventListener('mousedown', onMid);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.key === 'w' || e.key === 'W') { setTcMode('translate'); set({ tcModeVal: 'translate' }); }
      if (e.key === 'e' || e.key === 'E') { setTcMode('rotate');    set({ tcModeVal: 'rotate' });    }
      if (e.key === 'r' || e.key === 'R') { setTcMode('scale');     set({ tcModeVal: 'scale' });     }
      if (e.key === 'Escape')              setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  useEffect(() => {
    const SMALL = { 'Shadow Blur': 0.01, 'Shadow Bias': 0.01, 'Contrast': 0.01, 'Brightness': 0.01, 'Saturation': 0.01 };
    const onArrow = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const el = document.activeElement;
      if (!el || el.tagName !== 'INPUT') return;
      e.preventDefault(); e.stopPropagation();
      let label = '';
      let node = el.parentElement;
      for (let i = 0; i < 6 && node; i++) {
        const lbl = node.querySelector('label');
        if (lbl) { label = lbl.textContent.trim(); break; }
        node = node.parentElement;
      }
      const step = SMALL[label] ?? 0.1;
      const dir  = e.key === 'ArrowUp' ? 1 : -1;
      const next = +((parseFloat(el.value) || 0) + dir * step).toFixed(6);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(next));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.addEventListener('keydown', onArrow, true);
    return () => window.removeEventListener('keydown', onArrow, true);
  }, []);

  const selectedObject = selected === DIRLIGHT_IDX
    ? dirLightRef.current
    : selected === MODEL_IDX
    ? modelRef.current
    : selected === KIRI_IDX
    ? kiriRef.current
    : selected === KANAN_IDX
    ? kananRef.current
    : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#000' }}>
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{ position: [0, 0, 6], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onPointerMissed={() => setSelected(null)}
      >
        <CameraFov fov={fov} />
        <ToneMappingSetup type={toneMapping} />
        <hemisphereLight color={hemiSky} groundColor={hemiGround} intensity={hemiIntensity} />
        <DirLight
          groupRef={dirLightRef}
          position={positions[DIRLIGHT_IDX]}
          color={dlColor}
          intensity={dlIntensity}
          shadowIntensity={dlShadow}
          target={dlTarget}
          shadowRes={shadowRes}
          selected={selected === DIRLIGHT_IDX}
          onSelect={() => setSelected(DIRLIGHT_IDX)}
        />
        <Model
          groupRef={modelRef}
          glbPath="/fullcomp.glb"
          meshMultMap={{ 'Full_Branch': 'branch', 'Full_Petals': 'flower' }}
          position={positions[MODEL_IDX]}
          rotation={rotations[MODEL_IDX]}
          anisotropy={anisotropy}
          roughness={roughness}
          metalness={metalness}
          clearcoat={clearcoat}
          clearcoatRoughness={clearcoatRoughness}
          sheen={sheen}
          sheenRoughness={sheenRoughness}
          selected={selected === MODEL_IDX}
          onSelect={() => setSelected(MODEL_IDX)}
          swayRef={swayRef}
        />
        <Model
          groupRef={kiriRef}
          glbPath="/kiri.glb"
          meshMultMap={{ 'Orchid Flowers on Branch.002': 'branch', 'Bake 1.001': 'flower' }}
          position={positions[KIRI_IDX]}
          rotation={rotations[1]}
          anisotropy={anisotropy}
          roughness={roughness}
          metalness={metalness}
          clearcoat={clearcoat}
          clearcoatRoughness={clearcoatRoughness}
          sheen={sheen}
          sheenRoughness={sheenRoughness}
          selected={selected === KIRI_IDX}
          onSelect={() => setSelected(KIRI_IDX)}
          swayRef={swayRef}
        />
        <Model
          groupRef={kananRef}
          glbPath="/kanan.glb"
          meshMultMap={{ 'Orchid Flowers on Branch.001': 'branch', 'Bake 1.002': 'flower', 'Bake 1.003': 'flower', 'Bake 1.004': 'flower' }}
          position={positions[KANAN_IDX]}
          rotation={rotations[2]}
          anisotropy={anisotropy}
          roughness={roughness}
          metalness={metalness}
          clearcoat={clearcoat}
          clearcoatRoughness={clearcoatRoughness}
          sheen={sheen}
          sheenRoughness={sheenRoughness}
          selected={selected === KANAN_IDX}
          onSelect={() => setSelected(KANAN_IDX)}
          swayRef={swayRef}
        />
        <SwayUpdate swayRef={swayRef} windAmp={swayWind} windSpeed={swaySpeed} />
        {selectedObject && (
          <TransformControls
            ref={tcRef}
            object={selectedObject}
            mode={tcMode}
            onObjectChange={() => {
              if (selected === DIRLIGHT_IDX && dirLightRef.current) {
                const p = dirLightRef.current.position;
                lastDragRef.current = { type: 'light', x: p.x, y: p.y, z: p.z };
              } else if (selected === MODEL_IDX && modelRef.current) {
                const g = modelRef.current;
                lastDragRef.current = { type: 'model', px: g.position.x, py: g.position.y, pz: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z };
              } else if (selected === KIRI_IDX && kiriRef.current) {
                const g = kiriRef.current;
                lastDragRef.current = { type: 'kiri', px: g.position.x, py: g.position.y, pz: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z };
              } else if (selected === KANAN_IDX && kananRef.current) {
                const g = kananRef.current;
                lastDragRef.current = { type: 'kanan', px: g.position.x, py: g.position.y, pz: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z };
              }
            }}
            onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false; }}
            onMouseUp={() => {
              if (orbitRef.current) orbitRef.current.enabled = true;
              const d = lastDragRef.current;
              if (!d) return;
              if (d.type === 'light') {
                setPositions(prev => prev.map((pos, i) => i === DIRLIGHT_IDX ? [d.x, d.y, d.z] : pos));
                set({ dlPos: { x: d.x, y: d.y, z: d.z } });
              } else if (d.type === 'model') {
                setPositions(prev => prev.map((pos, i) => i === MODEL_IDX ? [d.px, d.py, d.pz] : pos));
                setRotations(r => r.map((rot, i) => i === 0 ? [d.rx, d.ry, d.rz] : rot));
                set({ modelPos: { x: d.px, y: d.py, z: d.pz } });
                set({ modelRot: { x: d.rx, y: d.ry, z: d.rz } });
              } else if (d.type === 'kiri') {
                setPositions(prev => prev.map((pos, i) => i === KIRI_IDX ? [d.px, d.py, d.pz] : pos));
                setRotations(r => r.map((rot, i) => i === 1 ? [d.rx, d.ry, d.rz] : rot));
                set({ kiriPos: { x: d.px, y: d.py, z: d.pz } });
                set({ kiriRot: { x: d.rx, y: d.ry, z: d.rz } });
              } else if (d.type === 'kanan') {
                setPositions(prev => prev.map((pos, i) => i === KANAN_IDX ? [d.px, d.py, d.pz] : pos));
                setRotations(r => r.map((rot, i) => i === 2 ? [d.rx, d.ry, d.rz] : rot));
                set({ kananPos: { x: d.px, y: d.py, z: d.pz } });
                set({ kananRot: { x: d.rx, y: d.ry, z: d.rz } });
              }
              lastDragRef.current = null;
            }}
          />
        )}
        <axesHelper args={[3]} />
        <OrbitControls ref={orbitRef} makeDefault enableDamping={false} />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ff4d6d', '#69db7c', '#4dabf7']} labelColor="white" />
        </GizmoHelper>
        <EffectComposer>
          <SMAA />
          <ColorGradePass exposure={exposure} saturation={saturation} brightness={brightness} contrast={contrast} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
```

---

## Step 4 — Mount scene in index route

In `src/routes/index.tsx`, add `Scene3D` as the fixed background layer.

Find the `RouteComponent` return and add `<Scene3D />` as the first child:

```tsx
import Scene3D from '@/Scene3D'

// Inside RouteComponent return:
return (
  <>
    <Scene3D />
    <div className="relative flex h-full w-full flex-col justify-between" style={{ zIndex: 10 }}>
      {/* ... existing UI content ... */}
    </div>
  </>
)
```

> The UI wrapper needs `zIndex: 10` (or Tailwind `z-10`) so it sits above the canvas.  
> `pointer-events: none` on non-interactive UI elements prevents blocking canvas interaction.

---

## Step 5 — Verify vite.config.ts (no changes needed)

The UI repo vite config already handles everything. No changes needed for the 3D scene — drei loads draco decoder from CDN by default.

If you want local draco decoder (faster, offline-capable), add to `vite.config.ts`:

```ts
// Optional: copy draco decoder to public
import { viteStaticCopy } from 'vite-plugin-static-copy'

// in plugins array:
viteStaticCopy({
  targets: [{
    src: 'node_modules/three/examples/jsm/libs/draco/**/*',
    dest: 'draco'
  }]
})
```

And in app entry before any `useGLTF` call:
```ts
import { useGLTF } from '@react-three/drei'
useGLTF.setDecoderPath('/draco/')
```

**Skip this for now** — CDN draco works fine in dev.

---

## Step 6 — Check `three` version

UI repo has `three@0.184.0`, our scene was developed on `0.177.0`. No breaking changes between these for our usage. No action needed.

---

## Checklist

- [ ] `npm install @react-three/postprocessing postprocessing draco3d`
- [ ] Copy `fullcomp.glb`, `kiri.glb`, `kanan.glb` → `public/`
- [ ] Create `src/Scene3D.tsx` (full file content in Step 3)
- [ ] Import and mount `<Scene3D />` in `src/routes/index.tsx`
- [ ] `localStorage.clear()` in browser after first load (clears old leva cache)
- [ ] Confirm scene renders behind UI
