import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

function fibonacciHemisphere(n) {
  const gr = (1 + Math.sqrt(5)) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const theta = Math.acos(1 - (i + 0.5) / n);
    const phi   = 2 * Math.PI * i / gr;
    out.push([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]);
  }
  return out;
}

function buildAdjacency(indexArray, vertexCount) {
  const sets = [];
  for (let i = 0; i < vertexCount; i++) sets.push(new Set());
  for (let i = 0; i < indexArray.length; i += 3) {
    const a = indexArray[i], b = indexArray[i + 1], c = indexArray[i + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Array.from(s));
}

function smoothValues(values, adj, passes) {
  const buf = new Float32Array(values);
  const tmp = new Float32Array(values.length);
  for (let p = 0; p < passes; p++) {
    for (let vi = 0; vi < buf.length; vi++) {
      const neighbors = adj[vi];
      let sum = buf[vi], count = 1;
      for (let ni = 0; ni < neighbors.length; ni++) {
        sum += buf[neighbors[ni]];
        count++;
      }
      tmp[vi] = sum / count;
    }
    buf.set(tmp);
  }
  return buf;
}

self.onmessage = function ({ data }) {
  const {
    meshData, lightDir: ld, maxDist,
    shadowStrength, smoothPasses,
    aoRays, aoStrength, aoMaxDist,
    aoOnly,
  } = data;

  const meshes = meshData.map((md) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(md.position, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(md.normal,   3));
    if (md.uv) geo.setAttribute('uv', new THREE.BufferAttribute(md.uv, 2));
    if (md.index) {
      const arr = md.indexType === 'uint32' ? new Uint32Array(md.index) : new Uint16Array(md.index);
      geo.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.matrixWorld.fromArray(md.matrixWorld);
    mesh.name = md.name;
    return mesh;
  });

  meshes.forEach((m) => m.geometry.computeBoundsTree());

  const toLight   = new THREE.Vector3(ld[0], ld[1], ld[2]).normalize();
  const shadowVal = 1 - shadowStrength;

  const raycaster = new THREE.Raycaster();
  raycaster.near = 0.005;
  raycaster.far  = maxDist;
  raycaster.firstHitOnly = true;

  const aoRaycaster = new THREE.Raycaster();
  aoRaycaster.near = 0.01;
  aoRaycaster.far  = aoMaxDist;
  aoRaycaster.firstHitOnly = true;

  const aoSamples = aoRays > 0 ? fibonacciHemisphere(aoRays) : [];

  const _origin = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  const _T      = new THREE.Vector3();
  const _B      = new THREE.Vector3();
  const _up     = new THREE.Vector3();
  const _aoDir  = new THREE.Vector3();

  let totalVerts = 0;
  meshes.forEach((m) => { totalVerts += m.geometry.attributes.position.count; });
  let processed = 0, lastReported = -1;

  const results = [];

  for (const mesh of meshes) {
    const geo         = mesh.geometry;
    const posAttr     = geo.attributes.position;
    const nrmAttr     = geo.attributes.normal;
    const vertexCount = posAttr.count;

    const shadowValues = new Float32Array(vertexCount).fill(1.0);

    for (let vi = 0; vi < vertexCount; vi++) {
      _origin.fromBufferAttribute(posAttr, vi).applyMatrix4(mesh.matrixWorld);
      _normal.fromBufferAttribute(nrmAttr, vi).transformDirection(mesh.matrixWorld).normalize();

      _origin.addScaledVector(_normal, 0.01);

      if (!aoOnly) {
        const isFront = _normal.dot(toLight) > 0;
        if (!isFront) {
          shadowValues[vi] = shadowVal;
        } else {
          raycaster.set(_origin, toLight);
          if (raycaster.intersectObjects(meshes, false).length > 0) {
            shadowValues[vi] = shadowVal;
          }
        }
      }

      if (aoRays > 0 && shadowValues[vi] === 1.0) {
        _up.set(Math.abs(_normal.y) < 0.99 ? 0 : 1, Math.abs(_normal.y) < 0.99 ? 1 : 0, 0);
        _T.crossVectors(_up, _normal).normalize();
        _B.crossVectors(_normal, _T);

        let blocked = 0;
        for (const [sx, sy, sz] of aoSamples) {
          _aoDir.set(
            sx * _T.x + sy * _normal.x + sz * _B.x,
            sx * _T.y + sy * _normal.y + sz * _B.y,
            sx * _T.z + sy * _normal.z + sz * _B.z,
          ).normalize();
          aoRaycaster.set(_origin, _aoDir);
          if (aoRaycaster.intersectObjects(meshes, false).length > 0) blocked++;
        }
        shadowValues[vi] = 1.0 - (blocked / aoRays) * aoStrength;
      }

      processed++;
      const pct = Math.round((processed / totalVerts) * 100);
      if (pct !== lastReported) {
        lastReported = pct;
        self.postMessage({ type: 'progress', value: pct });
      }
    }

    let smoothed = shadowValues;
    if (geo.index && smoothPasses > 0) {
      const adj = buildAdjacency(geo.index.array, vertexCount);
      smoothed = smoothValues(shadowValues, adj, smoothPasses);
    }

    results.push({ name: mesh.name, shadowValues: smoothed });
  }

  meshes.forEach((m) => m.geometry.disposeBoundsTree?.());

  self.postMessage(
    { type: 'done', results },
    results.map((r) => r.shadowValues.buffer),
  );
};
