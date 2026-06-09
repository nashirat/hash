import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { EffectComposer, SMAA } from '@react-three/postprocessing';
import { Effect } from 'postprocessing';
import { Uniform } from 'three';
import { useControls, folder } from 'leva';
import * as THREE from 'three';

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

const MODEL_IDX   = 0;
const DIRLIGHT_IDX = 1;

// ── Model ─────────────────────────────────────────────────────────────────────
function Model({ position, rotation, selected, onSelect, groupRef, anisotropy,
                 roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness }) {
  const { scene } = useGLTF('/fullcomp.glb');
  const { gl } = useThree();
  const ready = useRef(false);
  const texturesRef = useRef([]);
  const matsRef = useRef([]);

  useEffect(() => {
    if (ready.current) return;
    ready.current = true;

    const box = new THREE.Box3().setFromObject(scene);
    scene.position.sub(box.getCenter(new THREE.Vector3()));

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
    });
    texturesRef.current = textures;
    matsRef.current = mats;
  }, [scene, gl]);

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

// ── Directional Light (grabbable) ─────────────────────────────────────────────
function DirLight({ groupRef, position, color, intensity, shadowIntensity,
                    target, shadowRes,
                    selected, onSelect }) {
  const lightRef = useRef();

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.target.position.set(target.x, target.y, target.z);
    light.target.updateMatrixWorld();
  }, [target]);


  return (
    <group ref={groupRef} position={position}>
      <directionalLight
        ref={lightRef}
        color={color}
        intensity={intensity}
        castShadow
        shadow-intensity={shadowIntensity}
        shadow-mapSize={[shadowRes, shadowRes]}
        shadow-bias={-0.0005}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      {/* visible marker */}
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={selected ? '#ffffff' : '#ffe566'} depthTest={false} />
      </mesh>
      {/* larger invisible hit area */}
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
    [0.17304607431398566, -0.7613390885327538, 0],    // model
    [1.781808006964472, -0.519731925338406, 0.1333767540734203],    // dirlight
  ]);
  const [rotations, setRotations] = useState([[0, -0.29330542185368386, 0]]);
  const [selected, setSelected]   = useState(null);
  const [tcMode, setTcMode]       = useState('translate');
  const [isDragging, setIsDragging] = useState(false);

  const orbitRef    = useRef(null);
  const tcRef       = useRef(null);
  const modelRef    = useRef(null);
  const dirLightRef = useRef(null);

  const [{ toneMapping, exposure, saturation, brightness, contrast,
           fov, modelPos, modelRot, anisotropy,
           roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness,
           dlPos, dlIntensity, dlColor, dlShadow,
           dlTarget, shadowRes,
           hemiSky, hemiGround, hemiIntensity,
           tcModeVal }, set] = useControls(() => ({
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
      anisotropy:         { label: 'Anisotropy',       value: 16,  options: [1, 2, 4, 8, 16]    },
      roughness:          { label: 'Roughness',         value: 1,   min: 0, max: 1, step: 0.01  },
      metalness:          { label: 'Metalness',         value: 0,   min: 0, max: 1, step: 0.01  },
      clearcoat:          { label: 'Clearcoat',         value: 0,   min: 0, max: 1, step: 0.01  },
      clearcoatRoughness: { label: 'Clearcoat Rough',   value: 0.1, min: 0, max: 1, step: 0.01  },
      sheen:              { label: 'Sheen',             value: 0,   min: 0, max: 1, step: 0.01  },
      sheenRoughness:     { label: 'Sheen Roughness',   value: 0.5, min: 0, max: 1, step: 0.01  },
      modelPos: {
        label: 'Position', value: { x: 0.17304607431398566, y: -0.7613390885327538, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === MODEL_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      modelRot: {
        label: 'Rotation', value: { x: 0, y: -0.29330542185368386, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations([[v.x, v.y, v.z]]);
        },
      },
    }),
    'Dir Light': folder({
      dlPos: {
        label: 'Position', value: { x: 1.781808006964472, y: -0.519731925338406, z: 0.1333767540734203 }, step: 0.1,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === DIRLIGHT_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      dlIntensity:   { label: 'Intensity',     value: 2,                   min: 0,    max: 20,   step: 0.1    },
      dlColor:       { label: 'Color',         value: '#ffffff'                                               },
      dlShadow:      { label: 'Shadow',        value: 1,                   min: 0,    max: 1,    step: 0.01   },
      dlTarget:      { label: 'Target',        value: { x: 0, y: 0, z: 0 },                     step: 0.1    },
      shadowRes:     { label: 'Shadow Res',    value: 2048,                options: [512, 1024, 2048, 4096]   },
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
  }));

  // Middle-click → reset camera
  useEffect(() => {
    const onMid = (e) => { if (e.button === 1) { e.preventDefault(); orbitRef.current?.reset(); } };
    window.addEventListener('mousedown', onMid);
    return () => window.removeEventListener('mousedown', onMid);
  }, []);

  // W / E / R hotkeys
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

  // TransformControls — orbit lock + leva sync on drag end
  useEffect(() => {
    const tc = tcRef.current;
    if (!tc) return;

    const onDrag = (e) => {
      setIsDragging(e.value);
      if (orbitRef.current) orbitRef.current.enabled = !e.value;
    };

    const onUp = () => {
      if (selected === DIRLIGHT_IDX) {
        const p = dirLightRef.current?.position;
        if (!p) return;
        setPositions(prev => prev.map((pos, i) => i === DIRLIGHT_IDX ? [p.x, p.y, p.z] : pos));
        set({ dlPos: { x: p.x, y: p.y, z: p.z } });
      } else if (selected === MODEL_IDX) {
        const g = modelRef.current;
        if (!g) return;
        setPositions(prev => prev.map((pos, i) => i === MODEL_IDX ? [g.position.x, g.position.y, g.position.z] : pos));
        setRotations([[g.rotation.x, g.rotation.y, g.rotation.z]]);
        set({ modelPos: { x: g.position.x, y: g.position.y, z: g.position.z } });
        set({ modelRot: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z } });
      }
    };

    tc.addEventListener('dragging-changed', onDrag);
    tc.addEventListener('mouseUp', onUp);
    return () => {
      tc.removeEventListener('dragging-changed', onDrag);
      tc.removeEventListener('mouseUp', onUp);
    };
  }, [selected, set]);

  const selectedObject = selected === DIRLIGHT_IDX
    ? dirLightRef.current
    : selected === MODEL_IDX
    ? modelRef.current
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
          const [mx, my, mz] = positions[MODEL_IDX];
          const [rx, ry, rz] = rotations[0];
          const [lx, ly, lz] = positions[DIRLIGHT_IDX];
          const vals = {
            toneMapping, exposure, saturation, brightness, contrast,
            fov, anisotropy, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenRoughness,
            modelPos: { x: mx, y: my, z: mz },
            modelRot: { x: rx, y: ry, z: rz },
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
          position={isDragging && selected === DIRLIGHT_IDX ? undefined : positions[DIRLIGHT_IDX]}
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
          position={isDragging && selected === MODEL_IDX ? undefined : positions[MODEL_IDX]}
          rotation={isDragging && selected === MODEL_IDX ? undefined : rotations[MODEL_IDX]}
          anisotropy={anisotropy}
          roughness={roughness}
          metalness={metalness}
          clearcoat={clearcoat}
          clearcoatRoughness={clearcoatRoughness}
          sheen={sheen}
          sheenRoughness={sheenRoughness}
          selected={selected === MODEL_IDX}
          onSelect={() => setSelected(MODEL_IDX)}
        />
        {selectedObject && (
          <TransformControls ref={tcRef} object={selectedObject} mode={tcMode} />
        )}
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
