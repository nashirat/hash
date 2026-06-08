import * as THREE from 'three';

export function bakeShadowWithWorker(root, shadowParams, onProgress) {
  return new Promise((resolve, reject) => {
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
      meshes.push(child);
    });

    const meshData = meshes.map((mesh) => {
      const geo     = mesh.geometry;
      const posAttr = geo.attributes.position;
      const nrmAttr = geo.attributes.normal;
      const uvAttr  = geo.attributes.uv;
      const idxAttr = geo.index;
      return {
        name:        mesh.name,
        position:    new Float32Array(posAttr.array),
        normal:      new Float32Array(nrmAttr.array),
        uv:          uvAttr  ? new Float32Array(uvAttr.array) : null,
        index:       idxAttr ? idxAttr.array.slice()          : null,
        indexType:   idxAttr ? (idxAttr.array instanceof Uint32Array ? 'uint32' : 'uint16') : null,
        matrixWorld: mesh.matrixWorld.elements.slice(),
      };
    });

    const worker = new Worker(new URL('./shadowBaker.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress(data.value); return; }
      if (data.type === 'done') {
        worker.terminate();
        const exportData = [];

        data.results.forEach((result) => {
          const mesh = meshes.find((m) => m.name === result.name);
          if (!mesh) return;

          mesh.geometry.setAttribute('shadowFactor', new THREE.BufferAttribute(result.shadowValues, 1));

          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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

          exportData.push({ name: result.name, shadowValues: Array.from(result.shadowValues) });
        });

        onProgress(100);
        resolve(exportData);
      }
    };

    worker.onerror = (e) => { worker.terminate(); reject(e); };

    worker.postMessage({
      meshData,
      lightDir:       [shadowParams.lx, shadowParams.ly, shadowParams.lz],
      maxDist:        shadowParams.dist,
      shadowStrength: shadowParams.strength,
      smoothPasses:   shadowParams.smoothPasses,
      aoRays:         shadowParams.aoRays,
      aoStrength:     shadowParams.aoStrength,
      aoMaxDist:      shadowParams.aoMaxDist,
      aoOnly:         shadowParams.aoOnly,
    });
  });
}

export function downloadShadowJson(exportData) {
  const json = JSON.stringify({ meshes: exportData }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'scene_shadow.json'; a.click();
  URL.revokeObjectURL(url);
}
