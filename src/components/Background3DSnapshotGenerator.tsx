import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setupGLTFLoader } from '../utils/draco';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileCount?: number;
  dirCount?: number;
  mtime: string;
  ext?: string;
}

const SUPPORTED_3D_EXTS = new Set([
  '.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx',
  '.splat', '.ksplat', '.spz',
]);

interface Background3DSnapshotGeneratorProps {
  entries: DirEntry[];
}

export const Background3DSnapshotGenerator: React.FC<Background3DSnapshotGeneratorProps> = ({ entries }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const processedPathsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<DirEntry[]>([]);
  const isProcessingRef = useRef<boolean>(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const totalBatchRef = useRef<number>(0);
  const processedBatchRef = useRef<number>(0);

  // Lazy initialize offscreen WebGL renderer and ensure it is attached to the DOM
  const getOrCreateRenderer = () => {
    if (!rendererRef.current) {
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.setSize(256, 256);
      renderer.setClearColor(new THREE.Color(0x131316), 1.0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      rendererRef.current = renderer;
    }

    // Canvas MUST be attached to DOM so Chromium compositor activates WebGL drawing buffer
    const container = containerRef.current;
    if (container && rendererRef.current && !container.contains(rendererRef.current.domElement)) {
      container.appendChild(rendererRef.current.domElement);
    }

    return rendererRef.current;
  };

  useEffect(() => {
    return () => {
      try {
        window.dispatchEvent(
          new CustomEvent('jabro-bg-activity', {
            detail: { active: false, text: '', subtext: '' },
          })
        );
      } catch {}
      if (rendererRef.current) {
        try {
          rendererRef.current.dispose();
        } catch {}
        rendererRef.current = null;
      }
    };
  }, []);

  // Process queue sequentially
  const processQueue = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const api = (typeof window !== 'undefined' ? (window as any).api : null) as any;
    if (!api?.saveThumbnailCache) {
      isProcessingRef.current = false;
      return;
    }

    while (queueRef.current.length > 0) {
      const entry = queueRef.current.shift();
      if (!entry) continue;

      processedBatchRef.current++;
      const currentIdx = processedBatchRef.current;
      const totalIdx = Math.max(totalBatchRef.current, currentIdx);

      try {
        window.dispatchEvent(
          new CustomEvent('jabro-bg-activity', {
            detail: {
              active: true,
              text: `Generating 3D preview (${currentIdx}/${totalIdx})`,
              subtext: entry.name,
              total: totalIdx,
              current: currentIdx,
            },
          })
        );
      } catch {}

      const filePath = entry.path;
      const ext = (entry.ext || '').toLowerCase();
      const mediaUrl = `jabro-media://localhost?path=${encodeURIComponent(filePath)}`;

      try {
        const isSplat = ['.splat', '.ksplat', '.spz'].includes(ext);

        if (isSplat) {
          // Offscreen Gaussian Splat snapshot
          await new Promise<void>((resolve) => {
            const container = containerRef.current;
            if (!container) {
              resolve();
              return;
            }

            container.innerHTML = '';
            let splatRenderer: THREE.WebGLRenderer | null = null;
            let viewer: any = null;
            let resolved = false;

            const cleanup = () => {
              if (resolved) return;
              resolved = true;
              try {
                if (viewer) {
                  viewer.stop();
                  viewer.dispose();
                }
                if (splatRenderer) {
                  splatRenderer.dispose();
                }
                if (container) {
                  container.innerHTML = '';
                }
              } catch {}
              resolve();
            };

            const timeoutId = setTimeout(cleanup, 9000);

            try {
              splatRenderer = new THREE.WebGLRenderer({
                antialias: false,
                preserveDrawingBuffer: true,
                alpha: false,
              });
              splatRenderer.setSize(256, 256);
              splatRenderer.setClearColor(new THREE.Color(0x131316), 1.0);
              container.appendChild(splatRenderer.domElement);

              let format: any = undefined;
              if (ext === '.splat') format = GaussianSplats3D.SceneFormat.Splat;
              else if (ext === '.ksplat') format = GaussianSplats3D.SceneFormat.KSplat;
              else if (ext === '.spz') format = GaussianSplats3D.SceneFormat.Spz;

              viewer = new GaussianSplats3D.Viewer({
                rootElement: container,
                renderer: splatRenderer,
                cameraUp: [0, 1, 0],
                initialCameraPosition: [0, 1.5, 4],
                initialCameraLookAt: [0, 0, 0],
                selfDrivenMode: true,
                useBuiltInControls: false,
                sharedMemoryForWorkers: true,
                dynamicScene: true,
                gpuAcceleratedSort: false,
                sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
              });

              viewer.addSplatScene(mediaUrl, {
                format,
                showLoadingUI: false,
              }).then(async () => {
                // Allow splats to load, sort, and render multiple frames
                await new Promise((r) => setTimeout(r, 700));

                try {
                  if (typeof viewer.render === 'function') {
                    viewer.render();
                  }
                  const dataUrl = splatRenderer!.domElement.toDataURL('image/jpeg', 0.88);
                  if (dataUrl && dataUrl.length > 200) {
                    api.saveThumbnailCache(filePath, dataUrl, entry.mtime, entry.size).then((ok: boolean) => {
                      if (ok) {
                        window.dispatchEvent(
                          new CustomEvent('jabro-thumbnail-saved', {
                            detail: { filePath, mtime: entry.mtime, size: entry.size },
                          })
                        );
                      }
                    }).catch(() => {});
                  }
                } catch {}

                clearTimeout(timeoutId);
                cleanup();
              }).catch(() => {
                clearTimeout(timeoutId);
                cleanup();
              });
            } catch {
              clearTimeout(timeoutId);
              cleanup();
            }
          });
        } else {
          // Offscreen Standard 3D Model snapshot (.glb, .gltf, .obj, .stl, .ply, .fbx)
          await new Promise<void>((resolve) => {
            const renderer = getOrCreateRenderer();
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0x131316);

            const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
            camera.position.set(3.2, 2.4, 4.0);
            camera.lookAt(0, 0, 0);

            // Studio lighting rig
            const amb = new THREE.AmbientLight(0xffffff, 1.1);
            scene.add(amb);
            const dir1 = new THREE.DirectionalLight(0xffffff, 1.6);
            dir1.position.set(8, 14, 10);
            scene.add(dir1);
            const dir2 = new THREE.DirectionalLight(0x93c5fd, 0.8);
            dir2.position.set(-10, 5, -8);
            scene.add(dir2);
            const hemi = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.6);
            scene.add(hemi);

            let resolved = false;
            let loadedObject: THREE.Object3D | null = null;
            let renderTriggered = false;
            let textureWaitTimer: any = null;

            // 25s timeout for heavy 50-100MB files
            const timeoutId = setTimeout(() => {
              console.warn('[Background3DSnapshotGenerator] Snapshot timed out for:', filePath);
              cleanupAndFinish();
            }, 25000);

            const cleanupAndFinish = () => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timeoutId);
              clearTimeout(textureWaitTimer);
              try {
                // Free geometry and material memory from scene
                scene.traverse((child: any) => {
                  if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                      child.material.forEach((m: any) => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                      });
                    } else if (child.material) {
                      if (child.material.map) child.material.map.dispose();
                      child.material.dispose();
                    }
                  }
                });
                scene.clear();

                // Also free loadedObject if it wasn't attached to scene
                if (loadedObject && !loadedObject.parent) {
                  loadedObject.traverse((child: any) => {
                    if (child.isMesh) {
                      if (child.geometry) child.geometry.dispose();
                      if (Array.isArray(child.material)) {
                        child.material.forEach((m: any) => {
                          if (m.map) m.map.dispose();
                          m.dispose();
                        });
                      } else if (child.material) {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                      }
                    }
                  });
                }
              } catch {}
              resolve();
            };

            // LoadingManager that tracks when external textures/resources finish loading
            const loadingManager = new THREE.LoadingManager();
            const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
            const dirPath = lastSlash !== -1 ? filePath.substring(0, lastSlash + 1) : '';

            loadingManager.setURLModifier((url: string) => {
              if (!url) return url;
              // Loaders resolve relative textures against the model URL's base, which is just
              // 'jabro-media://' (the path lives in the query), so only '?path=' URLs are already resolved
              if (
                url.startsWith('data:') ||
                url.startsWith('blob:') ||
                url.startsWith('jabro-media://localhost?path=') ||
                url.startsWith('http:') ||
                url.startsWith('https:')
              ) {
                return url;
              }
              let clean = url.replace(/\\/g, '/');
              clean = clean.split('?')[0].split('#')[0];
              const filename = clean.split('/').filter(Boolean).pop() || '';
              if (filename && dirPath) {
                return `jabro-media://localhost?path=${encodeURIComponent(dirPath + filename)}`;
              }
              return url;
            });

            const triggerRender = (object: THREE.Object3D) => {
              if (renderTriggered || resolved) return;
              renderTriggered = true;
              clearTimeout(textureWaitTimer);
              renderWithTextureWarmup(object);
            };

            // If external textures finish loading through loadingManager
            loadingManager.onLoad = () => {
              if (loadedObject) {
                triggerRender(loadedObject);
              }
            };

            loadingManager.onError = (itemUrl) => {
              console.warn('[Background3DSnapshotGenerator] Texture load warning (ignoring missing texture):', itemUrl);
            };

            const onModelLoaded = (object: THREE.Object3D) => {
              loadedObject = object;
              // Give external textures up to 400ms to download/decode.
              // If loadingManager finishes sooner, loadingManager.onLoad triggers immediately.
              // If there are no textures or they take too long, triggerRender fires at 400ms.
              textureWaitTimer = setTimeout(() => {
                triggerRender(object);
              }, 400);
            };

            const renderWithTextureWarmup = (object: THREE.Object3D) => {
              try {
                object.traverse((child: any) => {
                  if (child.isMesh) {
                    const m = child as THREE.Mesh;
                    m.frustumCulled = false;
                    if (m.geometry && !m.geometry.attributes.normal) {
                      m.geometry.computeVertexNormals();
                    }
                    const fixMat = (mat: any) => {
                      if (!mat) return;
                      mat.side = THREE.DoubleSide;
                      if (mat.opacity !== undefined && mat.opacity < 0.05) {
                        mat.opacity = 1.0;
                        mat.transparent = false;
                      }
                      if (mat.transparent && (!mat.opacity || mat.opacity >= 0.99) && !mat.alphaMap) {
                        if (!mat.map) mat.transparent = false;
                      }
                      mat.depthWrite = true;
                      mat.depthTest = true;
                      if (mat.color && mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0 && !mat.map) {
                        mat.color.setHex(0xb0b8c4);
                      }
                      if (mat.isMeshPhongMaterial) {
                        if (mat.shininess === 0 || mat.shininess === undefined) mat.shininess = 25;
                        if (mat.specular && mat.specular.r === 0 && mat.specular.g === 0 && mat.specular.b === 0) {
                          mat.specular.setHex(0x333333);
                        }
                      }
                      mat.needsUpdate = true;
                    };
                    if (Array.isArray(m.material)) m.material.forEach(fixMat);
                    else if (m.material) fixMat(m.material);
                  }
                });

                object.updateMatrixWorld(true);
                const box = new THREE.Box3();
                box.setFromObject(object);

                if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) {
                  object.traverse((child: any) => {
                    if (child.isMesh && child.geometry?.boundingBox) {
                      const meshBox = child.geometry.boundingBox.clone();
                      meshBox.applyMatrix4(child.matrixWorld);
                      box.union(meshBox);
                    }
                  });
                }

                if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) {
                  box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
                }

                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);

                const TARGET_SIZE = 3.5;
                const scale = (maxDim > 0 && isFinite(maxDim)) ? (TARGET_SIZE / maxDim) : 1;
                object.scale.set(scale, scale, scale);
                object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

                scene.add(object);

                // Multi-pass render:
                // Direct dual render ensures GPU buffers & textures are bound without depending on
                // requestAnimationFrame which Chromium throttles when the window is in background
                renderer.render(scene, camera);
                renderer.render(scene, camera);

                try {
                  const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.88);
                  if (dataUrl && dataUrl.length > 200) {
                    api.saveThumbnailCache(filePath, dataUrl, entry.mtime, entry.size).then((ok: boolean) => {
                      if (ok) {
                        window.dispatchEvent(
                          new CustomEvent('jabro-thumbnail-saved', {
                            detail: { filePath, mtime: entry.mtime, size: entry.size },
                          })
                        );
                      }
                    }).catch(() => {});
                  }
                } catch (err) {
                  console.warn('[Background3DSnapshotGenerator] Snapshot capture failed:', err);
                }
                cleanupAndFinish();
              } catch (err) {
                console.warn('[Background3DSnapshotGenerator] Snapshot error for:', filePath, err);
                cleanupAndFinish();
              }
            };

            const onError = (err: any) => {
              console.warn('[Background3DSnapshotGenerator] Model load error for:', filePath, err?.message || err);
              clearTimeout(textureWaitTimer);
              cleanupAndFinish();
            };

            const cleanExt = ext.replace('.', '');
            try {
              if (cleanExt === 'glb' || cleanExt === 'gltf') {
              const gltfLoader = setupGLTFLoader(new GLTFLoader(loadingManager));
              gltfLoader.load(mediaUrl, (gltf) => onModelLoaded(gltf.scene), undefined, onError);
            } else if (cleanExt === 'obj') {
              new OBJLoader(loadingManager).load(mediaUrl, onModelLoaded, undefined, onError);
            } else if (cleanExt === 'stl') {
              new STLLoader(loadingManager).load(mediaUrl, (geom) => {
                geom.computeVertexNormals();
                const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x93c5fd, roughness: 0.4, metalness: 0.2 }));
                onModelLoaded(mesh);
              }, undefined, onError);
            } else if (cleanExt === 'ply') {
              new PLYLoader(loadingManager).load(mediaUrl, (geom) => {
                geom.computeVertexNormals();
                const hasColor = geom.hasAttribute('color');
                const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
                  color: hasColor ? 0xffffff : 0x60a5fa,
                  vertexColors: hasColor,
                  roughness: 0.4,
                  metalness: 0.2,
                }));
                onModelLoaded(mesh);
              }, undefined, onError);
            } else if (cleanExt === 'fbx') {
              new FBXLoader(loadingManager).load(mediaUrl, onModelLoaded, undefined, onError);
            } else {
              cleanupAndFinish();
            }
          } catch (loadErr) {
            onError(loadErr);
          }
        });
        }
      } catch (err) {
        console.warn('[Background3DSnapshotGenerator] Error processing entry:', filePath, err);
      }

      // Small pause between models to maintain smooth 60fps UI
      await new Promise((r) => setTimeout(r, 120));
    }

    totalBatchRef.current = 0;
    processedBatchRef.current = 0;
    isProcessingRef.current = false;

    try {
      window.dispatchEvent(
        new CustomEvent('jabro-bg-activity', {
          detail: {
            active: false,
            text: '',
            subtext: '',
          },
        })
      );
    } catch {}
  };

  // Inspect entries and queue any 3D files in current view
  useEffect(() => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const api = (typeof window !== 'undefined' ? (window as any).api : null) as any;
    if (!api?.saveThumbnailCache) return;

    let cancelled = false;

    const checkAndQueue = async () => {
      const candidates = entries.filter((e) => {
        if (!e || e.isDirectory) return false;
        const ext = (e.ext || '').toLowerCase();
        if (!SUPPORTED_3D_EXTS.has(ext)) return false;
        if (processedPathsRef.current.has(e.path)) return false;
        return true;
      });

      if (candidates.length === 0 || cancelled) return;

      // Fast disk check: if thumbnails are already cached on disk, skip them!
      let missingCandidates = candidates;
      if (api.getThumbnailsBatch) {
        try {
          const cachedMap = await api.getThumbnailsBatch(
            candidates.map((c) => ({ filePath: c.path, mtime: c.mtime, size: c.size }))
          );
          if (cancelled) return;
          missingCandidates = candidates.filter((c) => !cachedMap[c.path]);
          // Mark already-cached candidates as processed so we don't query again
          for (const c of candidates) {
            if (cachedMap[c.path]) {
              processedPathsRef.current.add(c.path);
            }
          }
        } catch {}
      }

      if (missingCandidates.length === 0 || cancelled) return;

      totalBatchRef.current += missingCandidates.length;

      for (const candidate of missingCandidates) {
        processedPathsRef.current.add(candidate.path);
        queueRef.current.push(candidate);
      }

      if (queueRef.current.length > 0) {
        processQueue();
      }
    };

    checkAndQueue();

    return () => {
      cancelled = true;
    };
  }, [entries]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: -9999,
        top: -9999,
        width: 256,
        height: 256,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: -999,
      }}
      aria-hidden="true"
    />
  );
};
