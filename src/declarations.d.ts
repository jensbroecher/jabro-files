declare module '@mkkellogg/gaussian-splats-3d' {
  export enum SceneFormat {
    Splat = 0,
    KSplat = 1,
    Ply = 2,
    Spz = 3,
  }

  export interface ViewerOptions {
    rootElement?: HTMLElement;
    cameraUp?: [number, number, number];
    initialCameraPosition?: [number, number, number];
    initialCameraLookAt?: [number, number, number];
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    sharedMemoryForWorkers?: boolean;
    dynamicScene?: boolean;
    [key: string]: any;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: any): Promise<void>;
    start(): void;
    stop(): void;
    dispose(): Promise<void>;
    getSplatMesh(): any;
    resetCamera?(): void;
    [key: string]: any;
  }
}
