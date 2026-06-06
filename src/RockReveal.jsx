import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

function makeRevealMaterial(src, perlinTex) {
  const mat = src.clone();
  mat.transparent = true;
  mat.alphaTest = 0.01;

  const u = {
    uRevealY:          { value: -1000 },
    uEdgeSoftness:     { value: 0.008 },
    uNoiseScale:       { value: 0.35 },
    uNoiseStrength:    { value: 0.7 },
    uNoiseSpeed:       { value: 0.013 },
    uEdgeGlowWidth:    { value: 0.075 },
    uEdgeGlowIntensity:{ value: 4.0 },
    uPerlin:           { value: perlinTex },
    uTime:             { value: 0 },
  };
  mat.userData.u = u;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vWorld;
      `)
      .replace('#include <worldpos_vertex>', `
        #include <worldpos_vertex>
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float uRevealY, uEdgeSoftness, uNoiseScale, uNoiseStrength;
        uniform float uNoiseSpeed, uEdgeGlowWidth, uEdgeGlowIntensity, uTime;
        uniform sampler2D uPerlin;
        varying vec3 vWorld;
      `)
      .replace('#include <dithering_fragment>', `
        vec2 nuv = vWorld.xz * uNoiseScale + vec2(0.0, uTime * uNoiseSpeed);
        float noiseOff = (texture2D(uPerlin, nuv).r - 0.5) * uNoiseStrength;
        float effY = vWorld.y + noiseOff;

        float mask = smoothstep(uRevealY, uRevealY - uEdgeSoftness, effY);
        diffuseColor.a *= mask;
        if (diffuseColor.a < 0.01) discard;

        float glow = smoothstep(uEdgeGlowWidth, 0.0, abs(effY - uRevealY));
        outgoingLight += vec3(0.4, 0.85, 1.0) * glow * uEdgeGlowIntensity;

        #include <dithering_fragment>
      `);
  };

  return mat;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export default function RockReveal() {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    let disposed = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06111b);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 1000);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(2, 4, 5);
    scene.add(key);

    const perlinTex = new THREE.TextureLoader().load('/perlin.webp');
    perlinTex.wrapS = THREE.RepeatWrapping;
    perlinTex.wrapT = THREE.RepeatWrapping;

    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath('/basis/');
    ktx2.detectSupport(renderer);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setKTX2Loader(ktx2);

    const revealMats = [];
    let startY = -2, endY = 2, progress = 0, modelReady = false;

    loader.load('/models/intro_compressed.glb', (gltf) => {
      if (disposed) return;

      const model = gltf.scene;
      scene.add(model);

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3 / maxDim;

      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      model.updateWorldMatrix(true, true);

      const scaled = new THREE.Box3().setFromObject(model);
      startY = scaled.min.y - 0.05;
      endY   = scaled.max.y + 0.05;

      model.traverse((child) => {
        if (!child.isMesh) return;
        const arr = Array.isArray(child.material) ? child.material : [child.material];
        const next = arr.map((m) => { const rm = makeRevealMaterial(m, perlinTex); revealMats.push(rm); return rm; });
        child.material = next.length === 1 ? next[0] : next;
      });

      modelReady = true;
    });

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    const clock = new THREE.Clock();
    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.033);
      const time = clock.elapsedTime;

      if (modelReady) progress = Math.min(1, progress + dt / 6.0);
      const revealY = THREE.MathUtils.lerp(startY, endY, easeOutCubic(progress));

      for (const mat of revealMats) {
        mat.userData.u.uRevealY.value = revealY;
        mat.userData.u.uTime.value = time;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      host.removeChild(renderer.domElement);
      draco.dispose();
      ktx2.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={hostRef} style={{ width: '100vw', height: '100vh' }} />;
}
