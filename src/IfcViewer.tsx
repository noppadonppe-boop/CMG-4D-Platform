import {useEffect, type RefObject} from 'react';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';

export type IfcViewerSource = {
  id: string;
  name: string;
  blob: Blob;
};

export type IfcViewerStatus = {
  phase: 'loading' | 'ready' | 'error';
  message: string;
  progress?: number;
};

type IfcViewerProps = {
  source: IfcViewerSource | null;
  modelId: string;
  controls?: RefObject<any>;
  onStatus: (status: IfcViewerStatus | null) => void;
};

const WEB_IFC_WASM = 'https://unpkg.com/web-ifc@0.0.78/';

/**
 * Loads IFC through That Open Engine and mounts its Fragments model into the
 * R3F scene that already owns the viewport. That Open's renderer is not
 * created here, so OrbitControls, clipping and the existing R3F scene remain
 * the single source of truth for rendering.
 */
export default function IfcViewer({source, modelId, controls, onStatus}: IfcViewerProps) {
  const {camera, scene, invalidate} = useThree();

  useEffect(() => {
    if (!source) {
      onStatus(null);
      return;
    }

    let cancelled = false;
    let components: OBC.Components | undefined;
    let fragments: OBC.FragmentsManager | undefined;
    let model: Awaited<ReturnType<OBC.IfcLoader['load']>> | undefined;

    const fitCameraToModel = () => {
      if (!model || model.box.isEmpty()) return;
      const target = model.box.getCenter(new THREE.Vector3());
      const size = model.box.getSize(new THREE.Vector3());
      const radius = Math.max(0.5, size.length() / 2);
      const distance = radius * 2.8;
      camera.position.copy(target).add(new THREE.Vector3(1, -1, 0.85).normalize().multiplyScalar(distance));
      camera.lookAt(target);
      camera.near = Math.max(0.001, radius / 1000);
      camera.far = Math.max(1000, distance + radius * 10);
      camera.updateProjectionMatrix();
      if (controls?.current) {
        controls.current.target.copy(target);
        controls.current.maxDistance = Math.max(150, distance * 5);
        controls.current.minDistance = Math.max(0.01, radius * 0.05);
        controls.current.update();
      }
    };

    const load = async () => {
      onStatus({phase: 'loading', message: `กำลังเตรียม That Open Engine · ${source.name}`});
      try {
        const data = new Uint8Array(await source.blob.arrayBuffer());
        if (cancelled) return;

        components = new OBC.Components();
        components.init();
        fragments = components.get(OBC.FragmentsManager);
        fragments.init(await OBC.FragmentsManager.getWorker());

        // Keep the WASM version explicit so the browser parser and engine
        // stay aligned when the app is deployed from a different host.
        const ifcLoader = components.get(OBC.IfcLoader);
        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: {path: WEB_IFC_WASM, absolute: true},
        });

        if (cancelled) return;
        const loadedModel = await ifcLoader.load(data, true, modelId, {
          processData: {
            progressCallback: (progress: number) => {
              if (!cancelled) {
                onStatus({
                  phase: 'loading',
                  message: `กำลังแปลง IFC เป็น Fragments · ${Math.round(progress * 100)}%`,
                  progress: Math.round(progress * 100),
                });
              }
            },
          },
        });

        if (cancelled || !fragments) {
          try {
            await fragments?.core.disposeModel(loadedModel.modelId);
          } catch {
            // The cleanup path may already have disposed the fragments core.
          }
          return;
        }
        model = loadedModel;
        model.useCamera(camera as THREE.PerspectiveCamera | THREE.OrthographicCamera);
        scene.add(model.object);
        await fragments.core.update(true);
        fitCameraToModel();
        invalidate();
        onStatus({phase: 'ready', message: `IFC พร้อมใช้งาน · ${source.name}`});
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'ไม่สามารถโหลดไฟล์ IFC ได้';
          onStatus({phase: 'error', message});
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      onStatus(null);
      void (async () => {
        if (model && fragments) {
          scene.remove(model.object);
          try {
            await fragments.core.disposeModel(model.modelId);
          } catch {
            // The engine may already be disposed when a load is cancelled.
          }
        }
        components?.dispose();
        invalidate();
      })();
    };
  }, [camera, controls, invalidate, modelId, onStatus, scene, source]);

  return null;
}
