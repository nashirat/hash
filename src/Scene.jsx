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
// meshMultMap: { nodeName: 'branch' | 'flower' } — controls per-mesh sway amplitude
function Model({ position, rotation, scale, selected, onSelect, groupRef, anisotropy,
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

    // shared world-space pivot: bottom-center of entire scene
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

      // convert shared world pivot to this mesh's local space
      const localPivot = c.worldToLocal(worldPivot.clone());
      // amplitude multiplier via meshMultMap
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
      scale={scale}
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
export default function Scene() {
  const [positions, setPositions] = useState([
    [0.6118922208161856, -0.6011740780362356, 0],                         // fullcomp
    [1.0419919785326108, -0.738036807420386, 2.48559209649641],           // dirlight
    [-4.935919125616735, 1.232321298409813, 0],                           // kiri
    [11.653420826100549, -0.6302413794460366, -10.557948245570664],       // kanan
  ]);
  const [rotations, setRotations] = useState([
    [-0.0738592006998472, -0.2704458426989292, -0.011016516478293699],    // fullcomp
    [0.41203814434549135, 0.16486072551020498, -0.194917409168369],       // kiri
    [0.008516537299090172, -0.6935727097241621, -0.13142840110837334],    // kanan
  ]);
  const [scales, setScales] = useState([
    [1.3166110111048857, 1.3166110111048857, 1.3166110111048857],   // fullcomp
    [1.1235500819411783, 1.1235500819411783, 1.1235500819411783],   // kiri
    [1, 1, 1],                                                       // kanan
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
  const historyRef    = useRef([]);
  const historyIdxRef = useRef(-1);
  const swayRef       = useRef({ x: { value: 0 }, z: { value: 0 }, branchMult: { value: 1.0 }, flowerMult: { value: 0.6 } });

  const [{ toneMapping, exposure, saturation, brightness, contrast,
           fov, modelPos, modelRot, anisotropy,
           roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness,
           dlPos, dlIntensity, dlColor, dlShadow,
           dlTarget, shadowRes,
           hemiSky, hemiGround, hemiIntensity,
           tcModeVal,
           swayWind, swaySpeed, swayBranchMult, swayFlowerMult,
           kiriPos, kiriRot, kiriScale, kananPos, kananRot, kananScale,
           modelScale }, set] = useControls(() => ({
    Render: folder({
      toneMapping: { label: 'Tone Mapping', value: THREE.ACESFilmicToneMapping, options: {
        'ACES Filmic': THREE.ACESFilmicToneMapping,
        'AgX':         THREE.AgXToneMapping,
        'Neutral':     THREE.NeutralToneMapping,
        'Reinhard':    THREE.ReinhardToneMapping,
        'Cineon':      THREE.CineonToneMapping,
        'None':        THREE.LinearToneMapping,
      }},
      exposure:    { label: 'Exposure',    value: 2,    min: 0,  max: 10, step: 0.01 },
      saturation:  { label: 'Saturation',  value: 1.1,  min: 0,  max: 3,  step: 0.01 },
      brightness:  { label: 'Brightness',  value: 0,    min: -1, max: 1,  step: 0.01 },
      contrast:    { label: 'Contrast',    value: 0.1,  min: -1, max: 1,  step: 0.01 },
    }),
    Model: folder({
      fov:                { label: 'FOV',               value: 50,  min: 10, max: 120, step: 1    },
      anisotropy:         { label: 'Anisotropy',       value: 16,  options: [1, 2, 4, 8, 16]    },
      roughness:          { label: 'Roughness',         value: 1,   min: 0, max: 1, step: 0.01  },
      metalness:          { label: 'Metalness',         value: 0,   min: 0, max: 1, step: 0.01  },
      clearcoat:          { label: 'Clearcoat',         value: 0,   min: 0, max: 1, step: 0.01  },
      clearcoatRoughness: { label: 'Clearcoat Rough',   value: 0.1, min: 0, max: 1, step: 0.01  },
      sheen:              { label: 'Sheen',             value: 0,   min: 0, max: 1, step: 0.01  },
      sheenRoughness:     { label: 'Sheen Roughness',   value: 0.5, min: 0, max: 1, step: 0.01  },
      modelPos: {
        label: 'Position', value: { x: 0.6118922208161856, y: -0.6011740780362356, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === MODEL_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      modelRot: {
        label: 'Rotation', value: { x: -0.0738592006998472, y: -0.2704458426989292, z: -0.011016516478293699 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 0 ? [v.x, v.y, v.z] : rot));
        },
      },
      modelScale: {
        label: 'Scale', value: { x: 1.3166110111048857, y: 1.3166110111048857, z: 1.3166110111048857 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setScales(s => s.map((sc, i) => i === 0 ? [v.x, v.y, v.z] : sc));
        },
      },
    }),
    Kiri: folder({
      kiriPos: {
        label: 'Position', value: { x: -4.935919125616735, y: 1.232321298409813, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === KIRI_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      kiriRot: {
        label: 'Rotation', value: { x: 0.41203814434549135, y: 0.16486072551020498, z: -0.194917409168369 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 1 ? [v.x, v.y, v.z] : rot));
        },
      },
      kiriScale: {
        label: 'Scale', value: { x: 1.1235500819411783, y: 1.1235500819411783, z: 1.1235500819411783 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setScales(s => s.map((sc, i) => i === 1 ? [v.x, v.y, v.z] : sc));
        },
      },
    }),
    Kanan: folder({
      kananPos: {
        label: 'Position', value: { x: 11.653420826100549, y: -0.6302413794460366, z: -10.557948245570664 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === KANAN_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      kananRot: {
        label: 'Rotation', value: { x: 0.008516537299090172, y: -0.6935727097241621, z: -0.13142840110837334 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 2 ? [v.x, v.y, v.z] : rot));
        },
      },
      kananScale: {
        label: 'Scale', value: { x: 1, y: 1, z: 1 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setScales(s => s.map((sc, i) => i === 2 ? [v.x, v.y, v.z] : sc));
        },
      },
    }),
    'Dir Light': folder({
      dlPos: {
        label: 'Position', value: { x: 1.0419919785326108, y: -0.738036807420386, z: 2.48559209649641 }, step: 0.1,
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
      hemiIntensity: { label: 'Intensity', value: 0.5,     min: 0, max: 5,   step: 0.01  },
    }),
    Transform: folder({
      tcModeVal: {
        label: 'Mode', value: 'translate', options: ['translate', 'rotate', 'scale'],
        onChange: (v, _, { initial }) => { if (!initial) setTcMode(v); },
      },
    }),
    Sway: folder({
      swayWind:       { label: 'Wind Amp',       value: 0.018, min: 0,   max: 0.15, step: 0.001 },
      swaySpeed:      { label: 'Wind Speed',     value: 1.0,   min: 0,   max: 4,    step: 0.01  },
      swayBranchMult: { label: 'Branch Mult',    value: 1.0,   min: 0,   max: 3,    step: 0.01  },
      swayFlowerMult: { label: 'Flower Mult',    value: 0.6,   min: 0,   max: 3,    step: 0.01  },
    }),
  }));

  // sync leva mult sliders → swayRef (live, reactive)
  useEffect(() => { swayRef.current.branchMult.value = swayBranchMult; }, [swayBranchMult]);
  useEffect(() => { swayRef.current.flowerMult.value = swayFlowerMult; }, [swayFlowerMult]);

  // ── History helpers ──────────────────────────────────────────────────────────
  function pushHistory(newPositions, newRotations, newScales) {
    const stack = historyRef.current;
    stack.splice(historyIdxRef.current + 1);
    stack.push({
      positions: newPositions.map(p => [...p]),
      rotations: newRotations.map(r => [...r]),
      scales: newScales.map(s => [...s]),
    });
    if (stack.length > 50) stack.shift();
    historyIdxRef.current = stack.length - 1;
  }

  function applySnapshot(snap) {
    setPositions(snap.positions);
    setRotations(snap.rotations);
    setScales(snap.scales);
    const [mx, my, mz]       = snap.positions[MODEL_IDX];
    const [rx, ry, rz]       = snap.rotations[0];
    const [sx, sy, sz]        = snap.scales[0];
    const [lx, ly, lz]       = snap.positions[DIRLIGHT_IDX];
    const [kix, kiy, kiz]    = snap.positions[KIRI_IDX];
    const [krx, kry, krz]    = snap.rotations[1];
    const [ksx, ksy, ksz]    = snap.scales[1];
    const [knx, kny, knz]    = snap.positions[KANAN_IDX];
    const [knrx, knry, knrz] = snap.rotations[2];
    const [knsx, knsy, knsz] = snap.scales[2];
    set({
      modelPos:   { x: mx,   y: my,   z: mz   },
      modelRot:   { x: rx,   y: ry,   z: rz   },
      modelScale: { x: sx,   y: sy,   z: sz   },
      dlPos:      { x: lx,   y: ly,   z: lz   },
      kiriPos:    { x: kix,  y: kiy,  z: kiz  },
      kiriRot:    { x: krx,  y: kry,  z: krz  },
      kiriScale:  { x: ksx,  y: ksy,  z: ksz  },
      kananPos:   { x: knx,  y: kny,  z: knz  },
      kananRot:   { x: knrx, y: knry, z: knrz },
      kananScale: { x: knsx, y: knsy, z: knsz },
    });
  }

  // push initial snapshot once
  useEffect(() => {
    pushHistory(positions, rotations, scales);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Middle-click → reset camera
  useEffect(() => {
    const onMid = (e) => { if (e.button === 1) { e.preventDefault(); orbitRef.current?.reset(); } };
    window.addEventListener('mousedown', onMid);
    return () => window.removeEventListener('mousedown', onMid);
  }, []);

  // W / E / R + Ctrl+Z/Y hotkeys
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.key === 'w' || e.key === 'W') { setTcMode('translate'); set({ tcModeVal: 'translate' }); }
      if (e.key === 'e' || e.key === 'E') { setTcMode('rotate');    set({ tcModeVal: 'rotate' });    }
      if (e.key === 'r' || e.key === 'R') { setTcMode('scale');     set({ tcModeVal: 'scale' });     }
      if (e.key === 'Escape')              setSelected(null);
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const idx = historyIdxRef.current;
        if (idx <= 0) return;
        historyIdxRef.current = idx - 1;
        applySnapshot(historyRef.current[historyIdxRef.current]);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const idx = historyIdxRef.current;
        if (idx >= historyRef.current.length - 1) return;
        historyIdxRef.current = idx + 1;
        applySnapshot(historyRef.current[historyIdxRef.current]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  // Arrow-key step fix for leva inputs (0.1 per tick)
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
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <div style={hudStyle}>
        {selected === null
          ? 'Click to select  ·  Esc deselect'
          : 'W move  ·  E rotate  ·  R scale  ·  Esc deselect'}
      </div>
      <button
        style={btnStyle}
        onClick={() => {
          const [mx, my, mz]     = positions[MODEL_IDX];
          const [rx, ry, rz]     = rotations[0];
          const [lx, ly, lz]     = positions[DIRLIGHT_IDX];
          const [kix, kiy, kiz]  = positions[KIRI_IDX];
          const [krx, kry, krz]  = rotations[1];
          const [knx, kny, knz]  = positions[KANAN_IDX];
          const [knrx, knry, knrz] = rotations[2];
          const vals = {
            toneMapping, exposure, saturation, brightness, contrast,
            fov, anisotropy, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness,
            modelPos:   { x: mx, y: my, z: mz },
            modelRot:   { x: rx, y: ry, z: rz },
            modelScale: { x: scales[0][0], y: scales[0][1], z: scales[0][2] },
            kiriPos:    { x: kix, y: kiy, z: kiz },
            kiriRot:    { x: krx, y: kry, z: krz },
            kiriScale:  { x: scales[1][0], y: scales[1][1], z: scales[1][2] },
            kananPos:   { x: knx, y: kny, z: knz },
            kananRot:   { x: knrx, y: knry, z: knrz },
            kananScale: { x: scales[2][0], y: scales[2][1], z: scales[2][2] },
            dlPos: { x: lx, y: ly, z: lz },
            dlIntensity, dlColor, dlShadow,
            dlTarget, shadowRes,
            hemiSky, hemiGround, hemiIntensity,
          };
          navigator.clipboard.writeText(JSON.stringify(vals, null, 2)).then(() => {
            const btn = document.activeElement;
            const prev = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = prev; }, 1200);
          });
        }}
      >Export Values</button>
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
          scale={scales[0]}
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
          scale={scales[1]}
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
          scale={scales[2]}
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
                lastDragRef.current = { type: 'model', px: g.position.x, py: g.position.y, pz: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z, ssx: g.scale.x, ssy: g.scale.y, ssz: g.scale.z };
              } else if (selected === KIRI_IDX && kiriRef.current) {
                const g = kiriRef.current;
                lastDragRef.current = { type: 'kiri', px: g.position.x, py: g.position.y, pz: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z, ssx: g.scale.x, ssy: g.scale.y, ssz: g.scale.z };
              } else if (selected === KANAN_IDX && kananRef.current) {
                const g = kananRef.current;
                lastDragRef.current = { type: 'kanan', px: g.position.x, py: g.position.y, pz: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z, ssx: g.scale.x, ssy: g.scale.y, ssz: g.scale.z };
              }
            }}
            onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false; }}
            onMouseUp={() => {
              if (orbitRef.current) orbitRef.current.enabled = true;
              const d = lastDragRef.current;
              if (!d) return;
              let newPositions = positions.map(p => [...p]);
              let newRotations = rotations.map(r => [...r]);
              const newScales = scales.map(s => [...s]);
              if (d.type === 'light') {
                newPositions[DIRLIGHT_IDX] = [d.x, d.y, d.z];
                setPositions(newPositions);
                set({ dlPos: { x: d.x, y: d.y, z: d.z } });
              } else if (d.type === 'model') {
                newPositions[MODEL_IDX] = [d.px, d.py, d.pz];
                newRotations[0]         = [d.rx, d.ry, d.rz];
                newScales[0]            = [d.ssx, d.ssy, d.ssz];
                setPositions(newPositions);
                setRotations(newRotations);
                setScales(newScales);
                set({ modelPos: { x: d.px, y: d.py, z: d.pz } });
                set({ modelRot: { x: d.rx, y: d.ry, z: d.rz } });
                set({ modelScale: { x: d.ssx, y: d.ssy, z: d.ssz } });
              } else if (d.type === 'kiri') {
                newPositions[KIRI_IDX] = [d.px, d.py, d.pz];
                newRotations[1]        = [d.rx, d.ry, d.rz];
                newScales[1]           = [d.ssx, d.ssy, d.ssz];
                setPositions(newPositions);
                setRotations(newRotations);
                setScales(newScales);
                set({ kiriPos: { x: d.px, y: d.py, z: d.pz } });
                set({ kiriRot: { x: d.rx, y: d.ry, z: d.rz } });
                set({ kiriScale: { x: d.ssx, y: d.ssy, z: d.ssz } });
              } else if (d.type === 'kanan') {
                newPositions[KANAN_IDX] = [d.px, d.py, d.pz];
                newRotations[2]         = [d.rx, d.ry, d.rz];
                newScales[2]            = [d.ssx, d.ssy, d.ssz];
                setPositions(newPositions);
                setRotations(newRotations);
                setScales(newScales);
                set({ kananPos: { x: d.px, y: d.py, z: d.pz } });
                set({ kananRot: { x: d.rx, y: d.ry, z: d.rz } });
                set({ kananScale: { x: d.ssx, y: d.ssy, z: d.ssz } });
              }
              pushHistory(newPositions, newRotations, newScales);
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

const hudStyle = {
  position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
  background: 'rgba(0,0,0,0.65)', color: '#c4b5fd', fontFamily: 'monospace',
  fontSize: 11, padding: '6px 14px', borderRadius: 6,
  pointerEvents: 'none', zIndex: 10, letterSpacing: 0.5, whiteSpace: 'nowrap',
};

const btnStyle = {
  position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
  background: 'rgba(0,0,0,0.65)', color: '#c4b5fd', fontFamily: 'monospace',
  fontSize: 11, padding: '6px 14px', borderRadius: 6,
  border: '1px solid rgba(196,181,253,0.3)', cursor: 'pointer',
  zIndex: 10, letterSpacing: 0.5,
};
