import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { EffectComposer, ToneMapping, SMAA } from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import { Uniform } from 'three';
import { useControls, folder } from 'leva';
import * as THREE from 'three';

// ── Levels ────────────────────────────────────────────────────────────────────
class LevelsEffectImpl extends Effect {
  constructor() {
    super('LevelsEffect', /* glsl */`
      uniform float uInBlack;
      uniform float uInWhite;
      uniform float uGamma;
      uniform float uOutBlack;
      uniform float uOutWhite;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = clamp((inputColor.rgb - uInBlack) / max(uInWhite - uInBlack, 0.0001), 0.0, 1.0);
        c = pow(c, vec3(1.0 / max(uGamma, 0.0001)));
        c = uOutBlack + c * (uOutWhite - uOutBlack);
        outputColor = vec4(c, inputColor.a);
      }
    `, {
      uniforms: new Map([
        ['uInBlack',  new Uniform(0)],
        ['uInWhite',  new Uniform(1)],
        ['uGamma',    new Uniform(1)],
        ['uOutBlack', new Uniform(0)],
        ['uOutWhite', new Uniform(1)],
      ]),
    });
  }
}

function LevelsPass({ inBlack, inWhite, gamma, outBlack, outWhite }) {
  const effect = useMemo(() => new LevelsEffectImpl(), []);
  useEffect(() => { effect.uniforms.get('uInBlack').value  = inBlack;  }, [effect, inBlack]);
  useEffect(() => { effect.uniforms.get('uInWhite').value  = inWhite;  }, [effect, inWhite]);
  useEffect(() => { effect.uniforms.get('uGamma').value    = gamma;    }, [effect, gamma]);
  useEffect(() => { effect.uniforms.get('uOutBlack').value = outBlack; }, [effect, outBlack]);
  useEffect(() => { effect.uniforms.get('uOutWhite').value = outWhite; }, [effect, outWhite]);
  return <primitive object={effect} dispose={null} />;
}

// ── Saturation ────────────────────────────────────────────────────────────────
class SatEffectImpl extends Effect {
  constructor() {
    super('SatEffect', /* glsl */`
      uniform float uSat;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 sat = mix(vec3(lum), inputColor.rgb, uSat);
        outputColor = vec4(sat, inputColor.a);
      }
    `, {
      uniforms: new Map([['uSat', new Uniform(1.0)]]),
    });
  }
}

function SaturationPass({ saturation }) {
  const effect = useMemo(() => new SatEffectImpl(), []);
  useEffect(() => { effect.uniforms.get('uSat').value = saturation; }, [effect, saturation]);
  return <primitive object={effect} dispose={null} />;
}

// ─────────────────────────────────────────────────────────────────────────────

useGLTF.preload('/fullcomp.glb');

const FILES = ['/fullcomp.glb'];
const LIGHT_IDX = 1;

function Model({ file, position, rotation, selected, onSelect, groupRef,
                 roughness, metalness, clearcoat, clearcoatRoughness,
                 sheen, sheenRoughness }) {
  const { scene } = useGLTF(file);
  const { gl } = useThree();
  const matsRef = useRef([]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    scene.position.sub(box.getCenter(new THREE.Vector3()));

    const maxAniso = gl.capabilities.getMaxAnisotropy();
    const seenTextures = new Set();
    const mats = [];

    scene.traverse((c) => {
      if (!c.isMesh) return;
      c.castShadow = true;
      c.receiveShadow = true;
      if (!c.material._owned) {
        c.material = c.material.clone();
        c.material._owned = true;
      }
      // Apply anisotropic filtering to all textures on this material
      Object.values(c.material).forEach((val) => {
        if (val && val.isTexture && !seenTextures.has(val.uuid)) {
          seenTextures.add(val.uuid);
          val.anisotropy = maxAniso;
          val.needsUpdate = true;
        }
      });
      mats.push(c.material);
    });
    matsRef.current = mats;
  }, [scene, gl]);

  useEffect(() => { matsRef.current.forEach(m => { m.roughness          = roughness;          }); }, [roughness]);
  useEffect(() => { matsRef.current.forEach(m => { m.metalness          = metalness;          }); }, [metalness]);
  useEffect(() => { matsRef.current.forEach(m => { if ('clearcoat'          in m) m.clearcoat          = clearcoat;         }); }, [clearcoat]);
  useEffect(() => { matsRef.current.forEach(m => { if ('clearcoatRoughness' in m) m.clearcoatRoughness = clearcoatRoughness; }); }, [clearcoatRoughness]);
  useEffect(() => { matsRef.current.forEach(m => { if ('sheen'              in m) m.sheen              = sheen;             }); }, [sheen]);
  useEffect(() => { matsRef.current.forEach(m => { if ('sheenRoughness'     in m) m.sheenRoughness     = sheenRoughness;    }); }, [sheenRoughness]);

  useEffect(() => {
    matsRef.current.forEach((m) => {
      if (m.emissive) m.emissive.set(selected ? 0.08 : 0, selected ? 0.04 : 0, selected ? 0.25 : 0);
    });
  }, [selected]);

  return (
    <group ref={groupRef} position={position} rotation={rotation} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <primitive object={scene} />
    </group>
  );
}

function LightMarker({ position, selected, onSelect, groupRef, intensity, shadowIntensity }) {
  return (
    <group ref={groupRef} position={position}>
      <directionalLight
        intensity={intensity}
        castShadow
        shadow-intensity={shadowIntensity}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshBasicMaterial color={selected ? '#ffffff' : '#ffe566'} depthTest={false} />
      </mesh>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[0.6, 8, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial color="#222" />
    </mesh>
  );
}

export default function NewWay() {
  const [positions, setPositions] = useState([
    [0, 0, 0],
    [0, 8, 0],
  ]);
  const [rotations, setRotations] = useState([[0, 0, 0]]);
  const [selected, setSelected] = useState(null);
  const [tcMode, setTcMode] = useState('translate');
  const [isDragging, setIsDragging] = useState(false);

  const orbitRef = useRef(null);
  const tcRef = useRef(null);
  const lightGroupRef = useRef(null);
  const modelRef0 = useRef(null);
  const modelRefs = useMemo(() => [modelRef0], []);

  const [{ shadowIntensity, ambientIntensity, lightIntensity,
           inBlack, inWhite, gamma, outBlack, outWhite, saturation,
           roughness, metalness, clearcoat, clearcoatRoughness,
           sheen, sheenRoughness }, levaSet] = useControls(() => ({
    'Full Comp': folder({
      pos1: {
        label: 'Position', value: { x: 0, y: 0, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === 0 ? [v.x, v.y, v.z] : pos));
        },
      },
      rot1: {
        label: 'Rotation', value: { x: 0, y: 0, z: 0 }, step: 0.01,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setRotations(r => r.map((rot, i) => i === 0 ? [v.x, v.y, v.z] : rot));
        },
      },
    }),
    Light: folder({
      lightPos: {
        label: 'Position', value: { x: 0, y: 8, z: 0 }, step: 0.1,
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setPositions(p => p.map((pos, i) => i === LIGHT_IDX ? [v.x, v.y, v.z] : pos));
        },
      },
      lightIntensity:   { label: 'Light Intensity',  value: 1.5,  min: 0, max: 10, step: 0.01 },
      ambientIntensity: { label: 'Ambient',           value: 0.05, min: 0, max: 5,  step: 0.01 },
      shadowIntensity:  { label: 'Shadow Intensity',  value: 1,    min: 0, max: 1,  step: 0.01 },
    }),
    Levels: folder({
      inBlack:  { label: 'In Black',  value: 0, min: 0,   max: 1, step: 0.001 },
      inWhite:  { label: 'In White',  value: 1, min: 0,   max: 1, step: 0.001 },
      gamma:    { label: 'Gamma',     value: 1, min: 0.1, max: 4, step: 0.001 },
      outBlack: { label: 'Out Black', value: 0, min: 0,   max: 1, step: 0.001 },
      outWhite: { label: 'Out White', value: 1, min: 0,   max: 1, step: 0.001 },
    }),
    Color: folder({
      saturation: { label: 'Saturation', value: 1, min: 0, max: 3, step: 0.01 },
    }),
    Material: folder({
      roughness:          { label: 'Roughness',       value: 0.5, min: 0, max: 1, step: 0.01 },
      metalness:          { label: 'Metalness',       value: 0,   min: 0, max: 1, step: 0.01 },
      clearcoat:          { label: 'Clearcoat',       value: 0,   min: 0, max: 1, step: 0.01 },
      clearcoatRoughness: { label: 'Clearcoat Rough', value: 0.1, min: 0, max: 1, step: 0.01 },
      sheen:              { label: 'Sheen',           value: 0,   min: 0, max: 1, step: 0.01 },
      sheenRoughness:     { label: 'Sheen Roughness', value: 0.5, min: 0, max: 1, step: 0.01 },
    }),
    Transform: folder({
      mode: {
        value: 'translate',
        options: ['translate', 'rotate', 'scale'],
        onChange: (v, _, { initial }) => {
          if (initial) return;
          setTcMode(v);
        },
      },
    }),
  }));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'w' || e.key === 'W') { setTcMode('translate'); levaSet({ mode: 'translate' }); }
      if (e.key === 'e' || e.key === 'E') { setTcMode('rotate');    levaSet({ mode: 'rotate' });    }
      if (e.key === 'r' || e.key === 'R') { setTcMode('scale');     levaSet({ mode: 'scale' });     }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [levaSet]);

  useEffect(() => {
    const fixArrow = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const el = document.activeElement;
      if (!el || el.tagName !== 'INPUT') return;
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const next = +((parseFloat(el.value) || 0) + dir * 0.1).toFixed(6);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(next));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.addEventListener('keydown', fixArrow, true);
    return () => window.removeEventListener('keydown', fixArrow, true);
  }, []);

  useEffect(() => {
    const tc = tcRef.current;
    if (!tc) return;

    const onDraggingChanged = (e) => {
      setIsDragging(e.value);
      if (orbitRef.current) orbitRef.current.enabled = !e.value;
    };

    const onMouseUp = () => {
      if (selected === null) return;
      if (selected === LIGHT_IDX) {
        const p = lightGroupRef.current?.position;
        if (!p) return;
        setPositions(prev => prev.map((pos, i) => i === LIGHT_IDX ? [p.x, p.y, p.z] : pos));
        levaSet({ lightPos: { x: p.x, y: p.y, z: p.z } });
      } else {
        const ref = modelRefs[selected];
        if (!ref.current) return;
        const p = ref.current.position;
        const r = ref.current.rotation;
        setPositions(prev => prev.map((pos, i) => i === selected ? [p.x, p.y, p.z] : pos));
        setRotations(prev => prev.map((rot, i) => i === selected ? [r.x, r.y, r.z] : rot));
        levaSet({ [`pos${selected + 1}`]: { x: p.x, y: p.y, z: p.z } });
        levaSet({ [`rot${selected + 1}`]: { x: r.x, y: r.y, z: r.z } });
      }
    };

    tc.addEventListener('dragging-changed', onDraggingChanged);
    tc.addEventListener('mouseUp', onMouseUp);
    return () => {
      tc.removeEventListener('dragging-changed', onDraggingChanged);
      tc.removeEventListener('mouseUp', onMouseUp);
    };
  }, [selected, levaSet, modelRefs]);

  const selectedObject = selected === LIGHT_IDX
    ? lightGroupRef.current
    : selected !== null ? modelRefs[selected]?.current : null;

  const lightPos = positions[LIGHT_IDX];

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <div style={hudStyle}>
        {selected === null ? 'Click object to select' : 'W translate · E rotate · R scale'}
      </div>
      <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 10 }}>
        <button style={btnStyle} onClick={() => orbitRef.current?.reset()}>Reset Camera</button>
        <button
          style={btnStyle}
          onClick={() => {
            const vals = {
              shadowIntensity, ambientIntensity, lightIntensity,
              inBlack, inWhite, gamma, outBlack, outWhite, saturation,
              roughness, metalness, clearcoat, clearcoatRoughness,
              sheen, sheenRoughness,
            };
            navigator.clipboard.writeText(JSON.stringify(vals, null, 2)).then((btn => () => {
              const prev = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = prev; }, 1200);
            })(document.activeElement));
          }}
        >Export Values</button>
      </div>
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{ position: [0, 3, 6], fov: 40 }}
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
        style={{ background: '#000' }}
        onPointerMissed={() => setSelected(null)}
      >
        <ambientLight intensity={ambientIntensity} />
        <LightMarker
          position={isDragging && selected === LIGHT_IDX ? undefined : lightPos}
          selected={selected === LIGHT_IDX}
          onSelect={() => setSelected(LIGHT_IDX)}
          groupRef={lightGroupRef}
          intensity={lightIntensity}
          shadowIntensity={shadowIntensity}
        />
        {FILES.map((file, i) => (
          <Model
            key={file}
            file={file}
            position={isDragging && selected === i ? undefined : positions[i]}
            rotation={isDragging && selected === i ? undefined : rotations[i]}
            selected={selected === i}
            onSelect={() => setSelected(i)}
            groupRef={modelRefs[i]}
            roughness={roughness}
            metalness={metalness}
            clearcoat={clearcoat}
            clearcoatRoughness={clearcoatRoughness}
            sheen={sheen}
            sheenRoughness={sheenRoughness}
          />
        ))}
        {selectedObject && (
          <TransformControls ref={tcRef} object={selectedObject} mode={tcMode} />
        )}
        <Floor />
        <OrbitControls ref={orbitRef} makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ff4d6d', '#69db7c', '#4dabf7']} labelColor="white" />
        </GizmoHelper>
        <EffectComposer>
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <SaturationPass saturation={saturation} />
          <LevelsPass inBlack={inBlack} inWhite={inWhite} gamma={gamma} outBlack={outBlack} outWhite={outWhite} />
          <SMAA />
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
  background: 'rgba(0,0,0,0.65)', color: '#c4b5fd', fontFamily: 'monospace',
  fontSize: 11, padding: '6px 14px', borderRadius: 6,
  border: '1px solid rgba(196,181,253,0.3)', cursor: 'pointer', letterSpacing: 0.5,
};
