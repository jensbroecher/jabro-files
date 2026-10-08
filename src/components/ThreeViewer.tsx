import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { 
  RotateCw, RotateCcw, ArrowUpDown, Grid, Eye, Box, Sparkles, Loader2, AlertCircle, RefreshCw, Disc
} from 'lucide-react';

interface ThreeViewerProps {
  filePath: string;
  fileName: string;
  isGaussianSplat?: boolean;
}

export const ThreeViewer: React.FC<ThreeViewerProps> = ({ filePath, fileName, isGaussianSplat = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [stats, setStats] = useState<{ vertices: number; triangles: number; splats?: number } | null>(null);

  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const isDefaultSplat = isGaussianSplat || ['splat', 'ksplat', 'spz'].includes(ext);

  // Allow switching between Splat and Mesh for .ply files
  const [renderMode, setRenderMode] = useState<'splat' | 'mesh'>(isDefaultSplat ? 'splat' : 'mesh');

  // Auto-detect if a .ply file is a Gaussian Splat
  useEffect(() => {
    if (ext === 'ply') {
      const api = (window as any).api;
      if (api?.detectPlyType) {
        api.detectPlyType(filePath).then((type: 'gaussian-splat' | '3d') => {
          if (type === 'gaussian-splat') {
            setRenderMode('splat');
          } else if (!isGaussianSplat) {
            setRenderMode('mesh');
          }
        }).catch(() => {});
      }
    }
  }, [ext, filePath, isGaussianSplat]);

  // References for standard Three.js
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // References for Gaussian Splatting
  const splatViewerRef = useRef<any>(null);

  // Build clean streaming URL
  const mediaUrl = `jabro-media://localhost?path=${encodeURIComponent(filePath)}`;

  // Reset camera view
  const handleResetCamera = useCallback(() => {
    if (renderMode === 'splat' && splatViewerRef.current) {
      try {
        const v = splatViewerRef.current;
        if (v.camera && v.controls) {
          v.camera.position.set(0, 1.5, 4);
          v.camera.up.set(0, 1, 0);
          v.camera.lookAt(0, 0, 0);
          v.controls.target.set(0, 0, 0);
          v.controls.update();
        } else if (v.resetCamera) {
          v.resetCamera();
        }
      } catch {}
      return;
    }

    if (cameraRef.current && controlsRef.current && modelRootRef.current) {
      const box = new THREE.Box3().setFromObject(modelRootRef.current);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
      if (cameraDistance === 0 || isNaN(cameraDistance)) cameraDistance = 5;

      cameraRef.current.position.set(cameraDistance * 0.7, cameraDistance * 0.5, cameraDistance);
      cameraRef.current.up.set(0, 1, 0);
      cameraRef.current.lookAt(0, 0, 0);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [renderMode]);

  // Flip Up/Down (180°) - solves upside-down splats or inverted models instantly
  const handleFlipUpDown = useCallback(() => {
    if (renderMode === 'splat' && splatViewerRef.current) {
      try {
        const scene = splatViewerRef.current.getSplatScene(0);
        if (scene) {
          scene.rotateZ(Math.PI);
          splatViewerRef.current.getSplatMesh()?.updateTransforms();
        }
      } catch (err) {
        console.error('Flip error:', err);
      }
    } else if (modelRootRef.current) {
      modelRootRef.current.rotateZ(Math.PI);
    }
  }, [renderMode]);

  // Rotate 90° (Pitch/Roll) - fixes coordinate axis orientation mismatches (Z-up vs Y-up)
  const handleRotate90 = useCallback(() => {
    if (renderMode === 'splat' && splatViewerRef.current) {
      try {
        const scene = splatViewerRef.current.getSplatScene(0);
        if (scene) {
          scene.rotateX(Math.PI / 2);
          splatViewerRef.current.getSplatMesh()?.updateTransforms();
        }
      } catch (err) {
        console.error('Rotate error:', err);
      }
    } else if (modelRootRef.current) {
      modelRootRef.current.rotateX(Math.PI / 2);
    }
  }, [renderMode]);

  // Toggle wireframe on standard meshes
  const toggleWireframe = useCallback(() => {
    const next = !wireframe;
    setWireframe(next);
    if (modelRootRef.current) {
      modelRootRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              if (m && 'wireframe' in m) {
                (m as any).wireframe = next;
              }
            });
          } else if (mesh.material && 'wireframe' in mesh.material) {
            (mesh.material as any).wireframe = next;
          }
        }
      });
    }
  }, [wireframe]);

  // Toggle grid
  const toggleGrid = useCallback(() => {
    setShowGrid(prev => {
      const next = !prev;
      if (gridHelperRef.current) {
        gridHelperRef.current.visible = next;
      }
      return next;
    });
  }, []);

  // Sync turntable auto-rotation across both Standard Three.js and Gaussian Splatting
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 1.0;
    }
    if (splatViewerRef.current?.controls) {
      splatViewerRef.current.controls.autoRotate = autoRotate;
      splatViewerRef.current.controls.autoRotateSpeed = 1.0;
    }
  }, [autoRotate]);

  // Gaussian Splatting loader
  const initGaussianSplat = useCallback(async () => {
    if (!containerRef.current) return;
    console.log('[ThreeViewer] initGaussianSplat starting for:', fileName, mediaUrl);
    setLoading(true);
    setLoadingProgress(0);
    setErrorMessage(null);

    // Clean any prior contents
    containerRef.current.innerHTML = '';

    try {
      // Natural upright orientation: cameraUp is [0, 1, 0]
      const viewer = new GaussianSplats3D.Viewer({
        rootElement: containerRef.current,
        cameraUp: [0, 1, 0],
        initialCameraPosition: [0, 1.5, 4],
        initialCameraLookAt: [0, 0, 0],
        selfDrivenMode: true,
        useBuiltInControls: true,
        sharedMemoryForWorkers: true,
        dynamicScene: true,
        gpuAcceleratedSort: false,
      });

      splatViewerRef.current = viewer;

      // Allow full 360 vertical orbit freedom without artificial polar angle clamps
      if (viewer.controls) {
        viewer.controls.maxPolarAngle = Math.PI;
        viewer.controls.minPolarAngle = 0;
        viewer.controls.autoRotate = autoRotate;
        viewer.controls.autoRotateSpeed = 1.0;
      }

      // Determine scene format
      let format: any = undefined;
      if (ext === 'splat') format = GaussianSplats3D.SceneFormat.Splat;
      else if (ext === 'ksplat') format = GaussianSplats3D.SceneFormat.KSplat;
      else if (ext === 'spz') format = GaussianSplats3D.SceneFormat.Spz;
      else if (ext === 'ply') format = GaussianSplats3D.SceneFormat.Ply;

      await viewer.addSplatScene(mediaUrl, {
        format,
        showLoadingUI: false,
        onProgress: (percent: number) => {
          const p = Math.round(percent || 0);
          setLoadingProgress(Math.min(100, Math.max(0, p)));
        },
      });

      viewer.start();
      setLoading(false);

      // Extract splat count if available
      try {
        const splatMesh = viewer.getSplatMesh();
        const splatCount = splatMesh?.getSplatCount?.() || 0;
        if (splatCount > 0) {
          setStats({ vertices: 0, triangles: 0, splats: splatCount });
        }
      } catch (err) {
        console.error('[ThreeViewer] Error getting splat count:', err);
      }
    } catch (err: any) {
      console.error('[ThreeViewer] Failed to load Gaussian Splat:', err);
      setErrorMessage(err?.message || 'Failed to initialize Gaussian Splatting scene.');
      setLoading(false);
    }
  }, [ext, mediaUrl, fileName]);

  // Standard Three.js loader for GLTF, OBJ, STL, PLY
  const initStandardThree = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    setLoading(true);
    setLoadingProgress(0);
    setErrorMessage(null);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f12);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 1000);
    camera.position.set(3, 2, 4);
    camera.up.set(0, 1, 0);
    cameraRef.current = camera;

    // WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.0;
    controlsRef.current = controls;

    // Lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.6);
    dirLight2.position.set(-10, -5, -10);
    scene.add(dirLight2);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x18181b, 0.6);
    scene.add(hemiLight);

    // Center and frame any loaded 3D model
    const setupModel = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      object.position.x -= center.x;
      object.position.y -= center.y;
      object.position.z -= center.z;

      scene.add(object);
      modelRootRef.current = object;

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
      if (cameraDistance === 0 || isNaN(cameraDistance)) cameraDistance = 5;

      camera.position.set(cameraDistance * 0.7, cameraDistance * 0.5, cameraDistance);
      camera.near = Math.max(0.01, cameraDistance / 100);
      camera.far = Math.max(500, cameraDistance * 20);
      camera.updateProjectionMatrix();

      controls.target.set(0, 0, 0);
      controls.update();

      // Ground grid helper
      const gridSize = Math.max(10, Math.ceil(maxDim * 2.5));
      const grid = new THREE.GridHelper(gridSize, 20, 0x3b82f6, 0x27272a);
      grid.position.y = -size.y / 2;
      scene.add(grid);
      gridHelperRef.current = grid;

      // Count vertices and triangles
      let totalVertices = 0;
      let totalTriangles = 0;
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          const geom = m.geometry;
          if (geom) {
            totalVertices += geom.attributes.position ? geom.attributes.position.count : 0;
            if (geom.index) {
              totalTriangles += geom.index.count / 3;
            } else if (geom.attributes.position) {
              totalTriangles += geom.attributes.position.count / 3;
            }
          }
        }
      });
      setStats({ vertices: totalVertices, triangles: Math.round(totalTriangles) });
      setLoading(false);
    };

    // Progress and error handlers
    const onProgress = (xhr: ProgressEvent) => {
      if (xhr.lengthComputable && xhr.total > 0) {
        setLoadingProgress(Math.round((xhr.loaded / xhr.total) * 100));
      }
    };

    const onError = (error: any) => {
      console.error('3D Model load error:', error);
      setErrorMessage(`Failed to load ${fileName}: ${error?.message || 'Unsupported or corrupted model data'}`);
      setLoading(false);
    };

    if (ext === 'gltf' || ext === 'glb') {
      const loader = new GLTFLoader();
      loader.load(mediaUrl, (gltf) => setupModel(gltf.scene), onProgress, onError);
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      loader.load(mediaUrl, (obj) => setupModel(obj), onProgress, onError);
    } else if (ext === 'stl') {
      const loader = new STLLoader();
      loader.load(
        mediaUrl,
        (geometry) => {
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: 0x93c5fd,
            metalness: 0.2,
            roughness: 0.4,
          });
          const mesh = new THREE.Mesh(geometry, material);
          setupModel(mesh);
        },
        onProgress,
        onError
      );
    } else if (ext === 'ply') {
      const loader = new PLYLoader();
      loader.load(
        mediaUrl,
        (geometry) => {
          geometry.computeVertexNormals();
          const hasColor = geometry.hasAttribute('color');
          let material: THREE.Material;
          let obj: THREE.Object3D;

          if (geometry.index || geometry.attributes.normal) {
            material = new THREE.MeshStandardMaterial({
              color: hasColor ? 0xffffff : 0x60a5fa,
              vertexColors: hasColor,
              metalness: 0.2,
              roughness: 0.4,
            });
            obj = new THREE.Mesh(geometry, material);
          } else {
            // Point Cloud
            material = new THREE.PointsMaterial({
              size: 0.03,
              vertexColors: hasColor,
              color: hasColor ? 0xffffff : 0x38bdf8,
            });
            obj = new THREE.Points(geometry, material);
          }
          setupModel(obj);
        },
        onProgress,
        onError
      );
    } else {
      setErrorMessage(`Unsupported 3D format: .${ext}`);
      setLoading(false);
    }

    // Animation Loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      renderer.dispose();
      scene.clear();
    };
  }, [ext, fileName, mediaUrl]);

  // Mount active renderer depending on renderMode
  useEffect(() => {
    if (renderMode === 'splat') {
      console.log('[ThreeViewer useEffect] Calling initGaussianSplat');
      initGaussianSplat();
      return () => {
        console.log('[ThreeViewer useEffect] Cleaning up GaussianSplat');
        if (splatViewerRef.current) {
          try {
            splatViewerRef.current.stop();
            splatViewerRef.current.dispose();
          } catch {}
          splatViewerRef.current = null;
        }
      };
    } else {
      const cleanup = initStandardThree();
      return () => {
        if (cleanup) cleanup();
      };
    }
  }, [renderMode, initGaussianSplat, initStandardThree]);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0b0b0d] rounded-b-xl overflow-hidden select-none">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full flex-1 overflow-hidden" />

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center gap-3 z-20">
          <Loader2 size={32} className="text-blue-400 animate-spin" />
          <div className="text-sm font-medium text-zinc-200">
            {renderMode === 'splat'
              ? (loadingProgress >= 100
                ? 'Processing & rendering radiance field...'
                : 'Loading 3D Gaussian Splat scene...')
              : 'Loading 3D model...'}
          </div>
          {loadingProgress > 0 && (
            <div className="w-48 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  renderMode === 'splat' && loadingProgress >= 100 ? 'bg-violet-500 animate-pulse' : 'bg-blue-500'
                }`}
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="absolute inset-0 bg-[#161214]/90 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center gap-3 z-30">
          <AlertCircle size={36} className="text-rose-400" />
          <div className="text-sm font-semibold text-rose-200">Could not render 3D asset</div>
          <div className="text-xs text-zinc-400 max-w-md font-mono">{errorMessage}</div>
        </div>
      )}

      {/* Toolbar / Controls Overlay */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10 bg-[#18181b]/85 backdrop-blur-md p-1 rounded-lg border border-zinc-700/60 shadow-lg text-xs">
        {/* PLY Format Mode Toggle (allows switching between Gaussian Splat and Standard Mesh) */}
        {ext === 'ply' && (
          <div className="flex items-center bg-zinc-800/90 rounded p-0.5 border border-zinc-700/50 mr-1">
            <button
              onClick={() => setRenderMode('splat')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition ${
                renderMode === 'splat' ? 'bg-violet-600 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Render as 3D Gaussian Splatting scene"
            >
              <Sparkles size={11} />
              <span>Splat</span>
            </button>
            <button
              onClick={() => setRenderMode('mesh')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition ${
                renderMode === 'mesh' ? 'bg-blue-600 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Render as Standard Polygon Mesh / Point Cloud"
            >
              <Box size={11} />
              <span>Mesh</span>
            </button>
          </div>
        )}

        {/* Camera Reset */}
        <button
          onClick={handleResetCamera}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
          title="Reset Camera to default view"
        >
          <RefreshCw size={13} />
          <span>Reset</span>
        </button>

        {/* Orientation Flips: 180° Up/Down and 90° Axis */}
        <button
          onClick={handleFlipUpDown}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
          title="Flip 180° Up/Down (fixes upside-down scenes)"
        >
          <ArrowUpDown size={13} />
          <span>Flip 180°</span>
        </button>

        <button
          onClick={handleRotate90}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
          title="Rotate 90° (align Z-up vs Y-up coordinate frames)"
        >
          <RotateCcw size={13} />
          <span>Rotate 90°</span>
        </button>

        {/* Universal Turntable Auto-Rotation (supports both Gaussian Splats and 3D Meshes) */}
        <button
          onClick={() => setAutoRotate(r => !r)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition cursor-pointer ${
            autoRotate
              ? (renderMode === 'splat' ? 'bg-violet-600 text-white shadow-xs font-semibold' : 'bg-blue-600 text-white shadow-xs font-semibold')
              : 'hover:bg-zinc-700 text-zinc-300 hover:text-white'
          }`}
          title="Toggle slow turntable rotation"
        >
          <Disc size={13} className={autoRotate ? 'animate-spin' : ''} style={{ animationDuration: '6s' }} />
          <span>Turntable</span>
        </button>

        {renderMode === 'mesh' && (
          <>

            <button
              onClick={toggleWireframe}
              className={`flex items-center gap-1 px-2 py-1 rounded transition cursor-pointer ${
                wireframe ? 'bg-blue-600 text-white' : 'hover:bg-zinc-700 text-zinc-300'
              }`}
              title="Toggle Wireframe mode"
            >
              <Box size={13} />
              <span>Wireframe</span>
            </button>

            <button
              onClick={toggleGrid}
              className={`flex items-center gap-1 px-2 py-1 rounded transition cursor-pointer ${
                showGrid ? 'bg-zinc-700 text-white' : 'hover:bg-zinc-700 text-zinc-400'
              }`}
              title="Toggle Ground Grid"
            >
              <Grid size={13} />
              <span>Grid</span>
            </button>
          </>
        )}
      </div>

      {/* Model Stats & Instructions Badge */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 z-10">
        <div className="bg-[#18181b]/85 backdrop-blur-md px-2.5 py-1 rounded-md border border-zinc-700/60 shadow text-[11px] text-zinc-400 flex items-center gap-2">
          {renderMode === 'splat' ? (
            <span className="flex items-center gap-1 text-violet-300 font-semibold">
              <Sparkles size={12} className="text-violet-400" />
              <span>3D Gaussian Splatting</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-blue-300 font-semibold">
              <Eye size={12} className="text-blue-400" />
              <span>3D Mesh ({ext.toUpperCase()})</span>
            </span>
          )}

          {stats && (
            <>
              <span className="text-zinc-600">•</span>
              {stats.splats ? (
                <span>{stats.splats.toLocaleString()} splats</span>
              ) : (
                <span>
                  {stats.vertices.toLocaleString()} verts • {stats.triangles.toLocaleString()} faces
                </span>
              )}
            </>
          )}
        </div>

        <div className="bg-[#18181b]/70 backdrop-blur-md px-2 py-1 rounded-md text-[10px] text-zinc-400 hidden sm:block">
          Left-click: Orbit • Right-click: Pan • Scroll: Zoom
        </div>
      </div>
    </div>
  );
};
