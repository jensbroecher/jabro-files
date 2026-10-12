import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { 
  RotateCw, RotateCcw, ArrowUpDown, Grid, Eye, Box, Sparkles, Loader2, AlertCircle, RefreshCw, Disc,
  Camera, Layers, Palette, Sun, ChevronDown, Check
} from 'lucide-react';

export type BgPreset = 'mist' | 'studio' | 'slate' | 'neutral' | 'charcoal' | 'whitish' | 'pureWhite';

export const BG_CONFIG: Record<BgPreset, { label: string; color: number; hex: string; fog: boolean; isLight?: boolean }> = {
  mist: { label: 'Cold Mist', color: 0x0c141f, hex: '#0c141f', fog: true },
  studio: { label: 'Studio Dark', color: 0x0f0f12, hex: '#0f0f12', fog: false },
  slate: { label: 'Midnight Slate', color: 0x0f172a, hex: '#0f172a', fog: false },
  neutral: { label: 'Neutral Gray', color: 0x22232a, hex: '#22232a', fog: false },
  charcoal: { label: 'Warm Charcoal', color: 0x1c1917, hex: '#1c1917', fog: false },
  whitish: { label: 'Studio Light', color: 0xf1f5f9, hex: '#f1f5f9', fog: false, isLight: true },
  pureWhite: { label: 'Pure White', color: 0xffffff, hex: '#ffffff', fog: false, isLight: true },
};

export type LightPreset = 'studio' | 'daylight' | 'dramatic' | 'sunset' | 'cyberpunk' | 'neutral';

export interface LightConfig {
  label: string;
  description: string;
  ambient: { color: number; intensity: number };
  dir1: { color: number; intensity: number; pos: [number, number, number] };
  dir2?: { color: number; intensity: number; pos: [number, number, number] };
  dir3?: { color: number; intensity: number; pos: [number, number, number] };
  hemi?: { skyColor: number; groundColor: number; intensity: number };
}

export const LIGHT_CONFIGS: Record<LightPreset, LightConfig> = {
  studio: {
    label: 'Studio 3-Point',
    description: 'Clean balanced studio lighting with warm key and cool fill',
    ambient: { color: 0xffffff, intensity: 0.8 },
    dir1: { color: 0xffffff, intensity: 1.4, pos: [8, 14, 10] },
    dir2: { color: 0x93c5fd, intensity: 0.7, pos: [-10, 5, -8] },
    dir3: { color: 0xffffff, intensity: 0.5, pos: [0, -6, -10] },
    hemi: { skyColor: 0xffffff, groundColor: 0x1e293b, intensity: 0.5 },
  },
  daylight: {
    label: 'Bright Sun',
    description: 'Crisp outdoor sunlight with high brightness and sky bounce',
    ambient: { color: 0xffffff, intensity: 1.1 },
    dir1: { color: 0xfffbeb, intensity: 2.2, pos: [12, 18, 8] },
    dir2: { color: 0xbae6fd, intensity: 0.8, pos: [-10, 8, -10] },
    hemi: { skyColor: 0xe0f2fe, groundColor: 0x334155, intensity: 0.8 },
  },
  dramatic: {
    label: 'Dramatic Rim',
    description: 'Cinematic high-contrast with electric rim highlights',
    ambient: { color: 0x1e293b, intensity: 0.25 },
    dir1: { color: 0xffffff, intensity: 1.6, pos: [10, 8, 5] },
    dir2: { color: 0x38bdf8, intensity: 2.4, pos: [-10, 10, -12] },
    dir3: { color: 0x475569, intensity: 0.4, pos: [0, -8, 8] },
    hemi: { skyColor: 0x334155, groundColor: 0x090d16, intensity: 0.25 },
  },
  sunset: {
    label: 'Golden Sunset',
    description: 'Golden hour amber directional sun with dusk purple fill',
    ambient: { color: 0xfef3c7, intensity: 0.6 },
    dir1: { color: 0xf97316, intensity: 2.2, pos: [12, 6, 8] },
    dir2: { color: 0xa855f7, intensity: 0.9, pos: [-10, 5, -10] },
    hemi: { skyColor: 0xfbbf24, groundColor: 0x581c87, intensity: 0.6 },
  },
  cyberpunk: {
    label: 'Cyberpunk Neon',
    description: 'Stylized dual-tone neon cyan and hot magenta contrast',
    ambient: { color: 0x0f172a, intensity: 0.4 },
    dir1: { color: 0x06b6d4, intensity: 2.2, pos: [10, 10, 10] },
    dir2: { color: 0xec4899, intensity: 2.0, pos: [-10, 6, -10] },
    dir3: { color: 0xf59e0b, intensity: 0.8, pos: [0, 15, 0] },
    hemi: { skyColor: 0x06b6d4, groundColor: 0x831843, intensity: 0.5 },
  },
  neutral: {
    label: 'Flat Inspection',
    description: 'Uniform shadowless lighting for CAD and texture inspection',
    ambient: { color: 0xffffff, intensity: 1.8 },
    dir1: { color: 0xffffff, intensity: 0.8, pos: [0, 15, 10] },
    dir2: { color: 0xffffff, intensity: 0.8, pos: [0, -10, -10] },
    hemi: { skyColor: 0xffffff, groundColor: 0xffffff, intensity: 0.7 },
  },
};

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
  const [turntableSpeed, setTurntableSpeed] = useState<0.5 | 1 | 2>(1);
  const [pointCloudMode, setPointCloudMode] = useState(false);
  const [bgPreset, setBgPreset] = useState<BgPreset>('mist');
  const [showBgMenu, setShowBgMenu] = useState(false);
  const [lightPreset, setLightPreset] = useState<LightPreset>('studio');
  const [lightIntensity, setLightIntensity] = useState<number>(1.0);
  const [showLightMenu, setShowLightMenu] = useState(false);
  const [flashSnapshot, setFlashSnapshot] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [stats, setStats] = useState<{ vertices: number; triangles: number; splats?: number } | null>(null);

  const bgMenuRef = useRef<HTMLDivElement>(null);
  const lightMenuRef = useRef<HTMLDivElement>(null);

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
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // References for Gaussian Splatting
  const splatViewerRef = useRef<any>(null);
  const splatRendererRef = useRef<THREE.WebGLRenderer | null>(null);

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

  // Sync turntable auto-rotation and speed across standard Three.js and Gaussian Splatting
  useEffect(() => {
    const speed = turntableSpeed * 1.5;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = speed;
    }
    if (splatViewerRef.current?.controls) {
      splatViewerRef.current.controls.autoRotate = autoRotate;
      splatViewerRef.current.controls.autoRotateSpeed = speed;
    }
  }, [autoRotate, turntableSpeed]);

  // Cycle turntable speed between 0.5x, 1.0x, 2.0x
  const cycleTurntableSpeed = useCallback(() => {
    setTurntableSpeed(curr => {
      if (curr === 0.5) return 1;
      if (curr === 1) return 2;
      return 0.5;
    });
  }, []);

  const lightsGroupRef = useRef<THREE.Group | null>(null);

  // Close dropdown menus when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (bgMenuRef.current && !bgMenuRef.current.contains(e.target as Node)) {
        setShowBgMenu(false);
      }
      if (lightMenuRef.current && !lightMenuRef.current.contains(e.target as Node)) {
        setShowLightMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Cycle background presets: Cold Mist -> Studio Dark -> Midnight Slate -> Neutral Gray -> Warm Charcoal -> Studio Light -> Pure White
  const cycleBgPreset = useCallback(() => {
    setBgPreset(curr => {
      if (curr === 'mist') return 'studio';
      if (curr === 'studio') return 'slate';
      if (curr === 'slate') return 'neutral';
      if (curr === 'neutral') return 'charcoal';
      if (curr === 'charcoal') return 'whitish';
      if (curr === 'whitish') return 'pureWhite';
      return 'mist';
    });
  }, []);

  // Dynamically update background color, fog, clear color, and grid across renderers
  useEffect(() => {
    const conf = BG_CONFIG[bgPreset];
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(conf.color);
      sceneRef.current.fog = conf.fog ? new THREE.FogExp2(conf.color, 0.02) : null;
    }
    if (rendererRef.current) {
      rendererRef.current.setClearColor(new THREE.Color(conf.color), 1.0);
    }
    if (splatRendererRef.current) {
      try {
        splatRendererRef.current.setClearColor(new THREE.Color(conf.color), 1.0);
      } catch {}
    } else if (splatViewerRef.current?.renderer) {
      try {
        splatViewerRef.current.renderer.setClearColor(new THREE.Color(conf.color), 1.0);
      } catch {}
    }
    if (containerRef.current) {
      containerRef.current.style.backgroundColor = conf.hex;
    }
    if (gridHelperRef.current) {
      try {
        const mat = (gridHelperRef.current as any).material;
        if (mat) {
          if (Array.isArray(mat)) {
            mat[0].color.setHex(0x3b82f6);
            mat[1].color.setHex(conf.isLight ? 0x94a3b8 : 0x27272a);
          } else if (mat.color) {
            mat.color.setHex(conf.isLight ? 0x94a3b8 : 0x27272a);
          }
        }
      } catch {}
    }
  }, [bgPreset]);

  // Lighting manager function
  const applyLighting = useCallback((scene: THREE.Scene, presetKey: LightPreset, intensity: number) => {
    if (lightsGroupRef.current) {
      scene.remove(lightsGroupRef.current);
      lightsGroupRef.current.clear();
      lightsGroupRef.current = null;
    }

    const group = new THREE.Group();
    group.name = 'JabroLightingGroup';
    const conf = LIGHT_CONFIGS[presetKey] || LIGHT_CONFIGS.studio;

    const amb = new THREE.AmbientLight(conf.ambient.color, conf.ambient.intensity * intensity);
    group.add(amb);

    const dir1 = new THREE.DirectionalLight(conf.dir1.color, conf.dir1.intensity * intensity);
    dir1.position.set(...conf.dir1.pos);
    group.add(dir1);

    if (conf.dir2) {
      const dir2 = new THREE.DirectionalLight(conf.dir2.color, conf.dir2.intensity * intensity);
      dir2.position.set(...conf.dir2.pos);
      group.add(dir2);
    }

    if (conf.dir3) {
      const dir3 = new THREE.DirectionalLight(conf.dir3.color, conf.dir3.intensity * intensity);
      dir3.position.set(...conf.dir3.pos);
      group.add(dir3);
    }

    if (conf.hemi) {
      const hemi = new THREE.HemisphereLight(conf.hemi.skyColor, conf.hemi.groundColor, conf.hemi.intensity * intensity);
      group.add(hemi);
    }

    scene.add(group);
    lightsGroupRef.current = group;
  }, []);

  // Update lighting on active scene whenever preset or intensity changes
  useEffect(() => {
    if (sceneRef.current) {
      applyLighting(sceneRef.current, lightPreset, lightIntensity);
    }
  }, [lightPreset, lightIntensity, applyLighting]);

  // Cycle lighting presets
  const cycleLightPreset = useCallback(() => {
    setLightPreset(curr => {
      if (curr === 'studio') return 'daylight';
      if (curr === 'daylight') return 'dramatic';
      if (curr === 'dramatic') return 'sunset';
      if (curr === 'sunset') return 'cyberpunk';
      if (curr === 'cyberpunk') return 'neutral';
      return 'studio';
    });
  }, []);

  // Cycle lighting intensity: 0.6x -> 1.0x -> 1.5x -> 2.0x -> 0.6x
  const cycleLightIntensity = useCallback(() => {
    setLightIntensity(curr => {
      if (curr <= 0.6) return 1.0;
      if (curr <= 1.0) return 1.5;
      if (curr <= 1.5) return 2.0;
      return 0.6;
    });
  }, []);

  // Toggle point cloud rendering mode for Gaussian Splats
  const togglePointCloud = useCallback(() => {
    setPointCloudMode(prev => {
      const next = !prev;
      if (splatViewerRef.current) {
        try {
          const mesh = splatViewerRef.current.getSplatMesh?.() || splatViewerRef.current.splatMesh;
          if (mesh && typeof mesh.setPointCloudModeEnabled === 'function') {
            mesh.setPointCloudModeEnabled(next);
          }
        } catch (err) {
          console.error('Point cloud mode toggle error:', err);
        }
      }
      return next;
    });
  }, []);

  // Snapshot capture to PNG
  const takeSnapshot = useCallback(() => {
    setFlashSnapshot(true);
    setTimeout(() => setFlashSnapshot(false), 250);

    try {
      let canvas: HTMLCanvasElement | null = null;
      if (renderMode === 'splat') {
        try {
          if (typeof splatViewerRef.current?.render === 'function') {
            splatViewerRef.current.render();
          }
        } catch {}
        canvas = splatRendererRef.current?.domElement || splatViewerRef.current?.renderer?.domElement || containerRef.current?.querySelector('canvas');
      } else {
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
          canvas = rendererRef.current.domElement;
        }
      }

      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        const cleanName = fileName.replace(/\.[^/.]+$/, '');
        a.href = dataUrl;
        a.download = `${cleanName}_snapshot.png`;
        a.click();
      }
    } catch (err) {
      console.error('Snapshot failed:', err);
    }
  }, [renderMode, fileName]);

  // Gaussian Splatting loader
  const initGaussianSplat = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    console.log('[ThreeViewer] initGaussianSplat starting for:', fileName, mediaUrl);
    setLoading(true);
    setLoadingProgress(0);
    setErrorMessage(null);

    // Clean any prior contents
    container.innerHTML = '';

    // Create a dedicated WebGLRenderer with preserveDrawingBuffer enabled
    // This allows crisp snapshots and tile thumbnail generation without black frames
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const splatRenderer = new THREE.WebGLRenderer({
      antialias: false,
      precision: 'highp',
      preserveDrawingBuffer: true,
      alpha: false,
    });
    splatRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    splatRenderer.setSize(width, height);
    const conf = BG_CONFIG[bgPreset];
    splatRenderer.setClearColor(new THREE.Color(conf.color), 1.0);

    container.appendChild(splatRenderer.domElement);
    splatRendererRef.current = splatRenderer;

    try {
      // Natural upright orientation: cameraUp is [0, 1, 0]
      const viewer = new GaussianSplats3D.Viewer({
        rootElement: container,
        renderer: splatRenderer,
        cameraUp: [0, 1, 0],
        initialCameraPosition: [0, 1.5, 4],
        initialCameraLookAt: [0, 0, 0],
        selfDrivenMode: true,
        useBuiltInControls: true,
        sharedMemoryForWorkers: true,
        dynamicScene: true,
        gpuAcceleratedSort: false,
        sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      });

      splatViewerRef.current = viewer;

      // Allow full 360 vertical orbit freedom without artificial polar angle clamps
      if (viewer.controls) {
        viewer.controls.maxPolarAngle = Math.PI;
        viewer.controls.minPolarAngle = 0;
        viewer.controls.autoRotate = autoRotate;
        viewer.controls.autoRotateSpeed = turntableSpeed * 1.5;
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
      try {
        splatRenderer.setClearColor(new THREE.Color(conf.color), 1.0);
        if (pointCloudMode) {
          viewer.getSplatMesh()?.setPointCloudModeEnabled(true);
        }
      } catch {}
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

      // Handle resize
      const handleResize = () => {
        if (!containerRef.current || !splatRendererRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        splatRendererRef.current.setSize(w, h);
        splatViewerRef.current?.forceRenderNextFrame?.();
      };
      window.addEventListener('resize', handleResize);

      // Auto-save rendered splat preview to central thumbnail cache
      setTimeout(() => {
        try {
          const api = (window as any).api;
          if (splatRendererRef.current && api?.saveThumbnailCache) {
            if (typeof splatViewerRef.current?.render === 'function') {
              splatViewerRef.current.render();
            }
            const dataUrl = splatRendererRef.current.domElement.toDataURL('image/jpeg', 0.88);
            if (dataUrl && dataUrl.length > 200) {
              api.saveThumbnailCache(filePath, dataUrl).then((ok: boolean) => {
                if (ok) {
                  window.dispatchEvent(new CustomEvent('jabro-thumbnail-saved', { detail: { filePath } }));
                }
              }).catch(() => {});
            }
          }
        } catch (err) {
          console.error('[ThreeViewer] Splat thumbnail auto-save error:', err);
        }
      }, 1000);
    } catch (err: any) {
      console.error('[ThreeViewer] Failed to load Gaussian Splat:', err);
      setErrorMessage(err?.message || 'Failed to initialize Gaussian Splatting scene.');
      setLoading(false);
    }
  }, [ext, mediaUrl, fileName, autoRotate, turntableSpeed, pointCloudMode, filePath]);

  // Standard Three.js loader for GLTF, OBJ, STL, PLY, FBX
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
    const conf = BG_CONFIG[bgPreset];
    scene.background = new THREE.Color(conf.color);
    if (conf.fog) scene.fog = new THREE.FogExp2(conf.color, 0.02);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 1000);
    camera.position.set(3, 2, 4);
    camera.up.set(0, 1, 0);
    cameraRef.current = camera;

    // WebGL Renderer with preserveDrawingBuffer enabled for high-fidelity snapshots
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(new THREE.Color(conf.color), 1.0);
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
    controls.autoRotateSpeed = turntableSpeed * 1.5;
    controlsRef.current = controls;

    // Lighting setup via configured preset & intensity
    applyLighting(scene, lightPreset, lightIntensity);

    // Center and frame any loaded 3D model
    const setupModel = (object: THREE.Object3D, animations?: THREE.AnimationClip[]) => {
      // 1. Process all child meshes, compute geometry normals/bounds, apply double-sided materials,
      // and fix FBX zero-opacity and black material bugs
      let totalVertices = 0;
      let totalTriangles = 0;

      object.traverse((child) => {
        if ((child as any).isMesh) {
          const m = child as THREE.Mesh;
          // Disable frustum culling: prevents skinned meshes or offset meshes from vanishing
          m.frustumCulled = false;
          m.castShadow = true;
          m.receiveShadow = true;

          const geom = m.geometry;
          if (geom) {
            if (!geom.attributes.normal) {
              geom.computeVertexNormals();
            }
            if (!geom.boundingBox) {
              geom.computeBoundingBox();
            }
            totalVertices += geom.attributes.position ? geom.attributes.position.count : 0;
            if (geom.index) {
              totalTriangles += geom.index.count / 3;
            } else if (geom.attributes.position) {
              totalTriangles += geom.attributes.position.count / 3;
            }
          }

          const fixMat = (mat: any) => {
            if (!mat) return;
            // Double-sided rendering ensures geometry is visible regardless of face winding/normal inversion
            mat.side = THREE.DoubleSide;

            // Fix FBX TransparencyFactor = 1.0 bug causing opacity = 0.0 (completely invisible mesh)
            if (mat.opacity !== undefined && mat.opacity < 0.05) {
              mat.opacity = 1.0;
              mat.transparent = false;
            }

            // If transparent is true but opacity is ~1.0 with no alpha map, disable transparency
            // to avoid depth sorting issues
            if (mat.transparent && (!mat.opacity || mat.opacity >= 0.99) && !mat.alphaMap) {
              if (!mat.map) {
                mat.transparent = false;
              }
            }

            mat.depthWrite = true;
            mat.depthTest = true;

            // Fix pitch-black diffuse color bug when textures fail or in untextured FBX exports
            if (mat.color && mat.color.r === 0 && mat.color.g === 0 && mat.color.b === 0 && !mat.map) {
              mat.color.setHex(0xb0b8c4);
            }

            // Ensure FBX materials (e.g. MeshPhongMaterial / MeshLambertMaterial) have specular and shininess
            if ((mat as any).isMeshPhongMaterial) {
              const phong = mat as THREE.MeshPhongMaterial;
              if (phong.shininess === 0 || phong.shininess === undefined) {
                phong.shininess = 25;
              }
              if (phong.specular && phong.specular.r === 0 && phong.specular.g === 0 && phong.specular.b === 0) {
                phong.specular.setHex(0x222222);
              }
            }

            if ('wireframe' in mat) {
              mat.wireframe = wireframe;
            }

            mat.needsUpdate = true;
          };

          if (Array.isArray(m.material)) {
            m.material.forEach(fixMat);
          } else if (m.material) {
            fixMat(m.material);
          } else {
            m.material = new THREE.MeshStandardMaterial({
              color: 0x93c5fd,
              roughness: 0.4,
              metalness: 0.2,
              side: THREE.DoubleSide,
              wireframe,
            });
          }
        }
      });

      setStats({ vertices: totalVertices, triangles: Math.round(totalTriangles) });

      // 2. Compute accurate bounding box
      object.updateMatrixWorld(true);
      const box = new THREE.Box3();
      box.setFromObject(object);

      if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) {
        // Fallback: compute bounding box directly from mesh geometries
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

      // 3. Normalize scale so ANY model size (from millimeters to meters to kilometers)
      // fits into viewer bounds cleanly without camera clipping or light distance issues
      const TARGET_SIZE = 3.5;
      const scale = (maxDim > 0 && isFinite(maxDim)) ? (TARGET_SIZE / maxDim) : 1;
      object.scale.set(scale, scale, scale);

      // Center the object at origin (0, 0, 0)
      object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      object.updateMatrixWorld(true);

      scene.add(object);
      modelRootRef.current = object;

      // 4. Start animation if model contains animations
      if (animations && animations.length > 0) {
        try {
          const mixer = new THREE.AnimationMixer(object);
          mixer.clipAction(animations[0]).play();
          mixerRef.current = mixer;
        } catch (err) {
          console.warn('[ThreeViewer] Animation mixer init error:', err);
        }
      }

      // 5. Camera & OrbitControls setup
      camera.position.set(3.0, 2.2, 4.0);
      camera.near = 0.05;
      camera.far = 1000;
      camera.updateProjectionMatrix();

      controls.target.set(0, 0, 0);
      controls.update();

      // 6. Ground grid helper
      const grid = new THREE.GridHelper(10, 20, 0x3b82f6, 0x27272a);
      grid.position.y = -(size.y * scale) / 2;
      scene.add(grid);
      gridHelperRef.current = grid;

      setLoading(false);

      // Auto-save rendered 3D preview to central thumbnail cache
      setTimeout(() => {
        try {
          const api = (window as any).api;
          if (rendererRef.current && sceneRef.current && cameraRef.current && api?.saveThumbnailCache) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
            const dataUrl = rendererRef.current.domElement.toDataURL('image/jpeg', 0.88);
            if (dataUrl && dataUrl.length > 200) {
              api.saveThumbnailCache(filePath, dataUrl).then((ok: boolean) => {
                if (ok) {
                  window.dispatchEvent(new CustomEvent('jabro-thumbnail-saved', { detail: { filePath } }));
                }
              }).catch(() => {});
            }
          }
        } catch {}
      }, 700);
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
      loader.load(mediaUrl, (gltf) => setupModel(gltf.scene, gltf.animations), onProgress, onError);
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
    } else if (ext === 'fbx') {
      const loadingManager = new THREE.LoadingManager();
      const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
      const dirPath = lastSlash !== -1 ? filePath.substring(0, lastSlash + 1) : '';

      loadingManager.setURLModifier((url: string) => {
        if (!url) return url;
        // Never modify already resolved or standard schemes (media protocol, data URLs, blobs, or web links)
        if (
          url.startsWith('data:') ||
          url.startsWith('blob:') ||
          url.startsWith('jabro-media:') ||
          url.startsWith('http:') ||
          url.startsWith('https:')
        ) {
          return url;
        }

        // Relative texture or local path embedded in FBX
        let clean = url.replace(/\\/g, '/');
        clean = clean.split('?')[0].split('#')[0];
        const filename = clean.split('/').filter(Boolean).pop() || '';
        if (filename && dirPath) {
          return `jabro-media://localhost?path=${encodeURIComponent(dirPath + filename)}`;
        }
        return url;
      });

      loadingManager.onError = (itemUrl) => {
        console.warn('[ThreeViewer] FBX texture/resource load warning (non-fatal):', itemUrl);
      };

      const loader = new FBXLoader(loadingManager);
      loader.load(
        mediaUrl,
        (obj) => {
          setupModel(obj, obj.animations);
        },
        onProgress,
        onError
      );
    } else {
      setErrorMessage(`Unsupported 3D format: .${ext}`);
      setLoading(false);
    }

    // Animation Loop
    const clock = new THREE.Clock();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (mixerRef.current) {
        try {
          mixerRef.current.update(delta);
        } catch (err) {
          console.warn('[ThreeViewer] Mixer update error:', err);
          mixerRef.current = null;
        }
      }
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
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }
      renderer.dispose();
      scene.clear();
    };
  }, [ext, fileName, mediaUrl, filePath]);

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
        if (splatRendererRef.current) {
          try {
            splatRendererRef.current.dispose();
          } catch {}
          splatRendererRef.current = null;
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

      {/* Snapshot Flash Overlay */}
      {flashSnapshot && (
        <div className="absolute inset-0 bg-white/60 pointer-events-none z-50 transition-opacity duration-200" />
      )}

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

        {/* Universal Turntable Auto-Rotation & Speed Switcher */}
        <div className="flex items-center bg-zinc-800/60 rounded border border-zinc-700/40">
          <button
            onClick={() => setAutoRotate(r => !r)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition cursor-pointer ${
              autoRotate
                ? (renderMode === 'splat' ? 'bg-violet-600 text-white font-semibold' : 'bg-blue-600 text-white font-semibold')
                : 'hover:bg-zinc-700 text-zinc-300 hover:text-white'
            }`}
            title="Toggle slow turntable rotation"
          >
            <Disc size={13} className={autoRotate ? 'animate-spin' : ''} style={{ animationDuration: `${6 / turntableSpeed}s` }} />
            <span>Turntable</span>
          </button>
          {autoRotate && (
            <button
              onClick={cycleTurntableSpeed}
              className="px-1.5 py-1 text-[11px] font-mono text-zinc-300 hover:text-white hover:bg-zinc-700 rounded-r border-l border-zinc-700/50 cursor-pointer"
              title="Cycle turntable speed (0.5x, 1x, 2x)"
            >
              {turntableSpeed}x
            </button>
          )}
        </div>

        {/* Gaussian Splats: Point Cloud Mode Toggle */}
        {renderMode === 'splat' && (
          <button
            onClick={togglePointCloud}
            className={`flex items-center gap-1 px-2 py-1 rounded transition cursor-pointer ${
              pointCloudMode ? 'bg-violet-600 text-white font-semibold' : 'hover:bg-zinc-700 text-zinc-300 hover:text-white'
            }`}
            title="Toggle Gaussian Splat Point Cloud mode (circular screen splats)"
          >
            <Layers size={13} />
            <span>Point Cloud</span>
          </button>
        )}

        {/* Stage Background Preset Menu */}
        <div className="relative" ref={bgMenuRef}>
          <button
            onClick={() => {
              setShowBgMenu(prev => !prev);
              setShowLightMenu(false);
            }}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
            title={`Stage Background: ${BG_CONFIG[bgPreset].label} (Click to change)`}
          >
            <Palette size={13} className="text-zinc-400" />
            <span 
              className="w-2.5 h-2.5 rounded-full border border-zinc-600 inline-block shadow-xs flex-shrink-0" 
              style={{ backgroundColor: BG_CONFIG[bgPreset].hex }}
            />
            <span>{BG_CONFIG[bgPreset].label}</span>
            <ChevronDown size={11} className={`text-zinc-400 transition-transform ${showBgMenu ? 'rotate-180' : ''}`} />
          </button>

          {showBgMenu && (
            <div className="absolute top-full left-0 mt-1.5 w-48 bg-[#18181b]/95 backdrop-blur-md rounded-lg border border-zinc-700/80 shadow-2xl p-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-zinc-400 border-b border-zinc-800 mb-1">
                Background Presets
              </div>
              {(Object.keys(BG_CONFIG) as BgPreset[]).map((key) => {
                const conf = BG_CONFIG[key];
                const isSelected = bgPreset === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setBgPreset(key);
                      setShowBgMenu(false);
                    }}
                    className={`flex items-center justify-between px-2 py-1.5 rounded text-xs transition cursor-pointer text-left ${
                      isSelected
                        ? 'bg-blue-600/20 text-blue-300 font-medium'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border border-zinc-500 shadow-xs flex-shrink-0"
                        style={{ backgroundColor: conf.hex }}
                      />
                      <span>{conf.label}</span>
                    </div>
                    {isSelected && <Check size={12} className="text-blue-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Lighting Rig Menu (for 3D models) */}
        {renderMode === 'mesh' && (
          <div className="relative" ref={lightMenuRef}>
            <button
              onClick={() => {
                setShowLightMenu(prev => !prev);
                setShowBgMenu(false);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
              title={`Lighting: ${LIGHT_CONFIGS[lightPreset].label} @ ${lightIntensity}x (Click to change)`}
            >
              <Sun size={13} className="text-amber-400" />
              <span>{LIGHT_CONFIGS[lightPreset].label}</span>
              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800/90 px-1 rounded border border-zinc-700/40">
                {lightIntensity}x
              </span>
              <ChevronDown size={11} className={`text-zinc-400 transition-transform ${showLightMenu ? 'rotate-180' : ''}`} />
            </button>

            {showLightMenu && (
              <div className="absolute top-full left-0 mt-1.5 w-72 bg-[#18181b]/95 backdrop-blur-md rounded-lg border border-zinc-700/80 shadow-2xl p-2 z-50 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between px-1 text-[10px] font-semibold tracking-wider uppercase text-zinc-400 border-b border-zinc-800 pb-1 mb-1">
                  <span>Lighting Rig</span>
                  <span className="text-amber-400 font-normal">Live 3D</span>
                </div>

                <div className="flex flex-col gap-0.5">
                  {(Object.keys(LIGHT_CONFIGS) as LightPreset[]).map((key) => {
                    const conf = LIGHT_CONFIGS[key];
                    const isSelected = lightPreset === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setLightPreset(key);
                        }}
                        className={`w-full flex flex-col px-2.5 py-1.5 rounded text-left transition cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full gap-2">
                          <span className="font-medium text-xs truncate">{conf.label}</span>
                          {isSelected && <Check size={13} className="text-amber-400 shrink-0 ml-auto" />}
                        </div>
                        <span className="text-[10px] text-zinc-400 leading-snug mt-0.5">{conf.description}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-1 pt-1.5 border-t border-zinc-800 flex items-center justify-between px-1">
                  <span className="text-[11px] text-zinc-400">Intensity</span>
                  <div className="flex items-center gap-1 bg-zinc-800/80 rounded p-0.5 border border-zinc-700/50">
                    {[0.6, 1.0, 1.5, 2.0].map((val) => (
                      <button
                        key={val}
                        onClick={() => setLightIntensity(val)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition ${
                          lightIntensity === val
                            ? 'bg-amber-500 text-black font-bold'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {val}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* High-Resolution Snapshot Capture */}
        <button
          onClick={takeSnapshot}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
          title="Capture clean high-resolution snapshot as PNG"
        >
          <Camera size={13} className="text-emerald-400" />
          <span>Snapshot</span>
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
