import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getConfirmatPlacement } from "./model.js";

const mmToWorld = (value) => value / 1000;
const worldToMm = (value) => value * 1000;

export class FurnitureScene {
  constructor(canvas, dimensionLayer) {
    this.canvas = canvas;
    this.dimensionLayer = dimensionLayer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdbe8f0);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.005, 100);
    this.camera.position.set(1.25, 0.95, 1.25);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI - 0.03;
    this.controls.target.set(0, 0.25, 0);
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;

    this.partsGroup = new THREE.Group();
    this.connectionsGroup = new THREE.Group();
    this.scene.add(this.partsGroup, this.connectionsGroup);
    this.meshes = new Map();
    this.selectedIds = new Set();
    this.selectedConnectionId = null;
    this.selectedConnectionPointIndex = null;
    this.raycaster = new THREE.Raycaster();
    this.confirmatVisibilityRaycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.dragPoint = new THREE.Vector3();
    this.model = null;
    this.viewMode = "3d";
    this.measurement = [];
    this.orientationPartId = null;

    this.dimensionLayer.addEventListener("pointerdown", (event) => {
      const control = event.target.closest?.("[data-orientation-part]");
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      const detail = { id: control.dataset.orientationPart };
      if (control.dataset.faceSide) {
        const faceSide = Number(control.dataset.faceSide);
        const part = this.model?.getPart(detail.id);
        detail.faceSide = part?.faceSide === faceSide ? null : faceSide;
      }
      if (control.dataset.frontDirection) detail.frontDirection = control.dataset.frontDirection;
      this.canvas.dispatchEvent(new CustomEvent("partorientationchange", { detail }));
    });

    this.partMaterial = new THREE.MeshStandardMaterial({ color: 0xe9dfcf, roughness: 0.66 });
    this.selectedMaterial = new THREE.MeshStandardMaterial({ color: 0x83c5e7, roughness: 0.56 });
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x53616c });
    this.selectedEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x087fc0 });
    this.hardwareMaterial = new THREE.MeshStandardMaterial({ color: 0x2e3131, roughness: 0.42, metalness: 0.2 });
    this.hardwareAccentMaterial = new THREE.MeshStandardMaterial({ color: 0x171919, roughness: 0.5, metalness: 0.12 });
    this.selectedHardwareMaterial = new THREE.MeshStandardMaterial({ color: 0x278fc5, roughness: 0.4, metalness: 0.15 });
    this.confirmatMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8c0c5,
      roughness: 0.3,
      metalness: 0.58,
    });
    this.selectedConfirmatMaterial = new THREE.MeshStandardMaterial({
      color: 0xd0d7db,
      roughness: 0.26,
      metalness: 0.54,
      emissive: 0x06364c,
      emissiveIntensity: 0.16,
    });
    this.confirmatSocketMaterial = new THREE.MeshStandardMaterial({
      color: 0x50595e,
      roughness: 0.42,
      metalness: 0.48,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.confirmatSocketBottomMaterial = new THREE.MeshStandardMaterial({
      color: 0x101416,
      roughness: 0.68,
      metalness: 0.22,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.createEnvironment();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.animate();
  }

  createEnvironment() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ color: 0xf4f2ed, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // The fine layer is the actual 1 mm grid; the second layer marks every 10 mm.
    const fineGrid = new THREE.GridHelper(2, 2000, 0xd0d9df, 0xe1e6e9);
    fineGrid.position.y = 0.0002;
    fineGrid.material.transparent = true;
    fineGrid.material.opacity = 0.38;
    const majorGrid = new THREE.GridHelper(2, 200, 0x8ea0ab, 0xb9c4ca);
    majorGrid.position.y = 0.0004;
    majorGrid.material.transparent = true;
    majorGrid.material.opacity = 0.56;
    this.scene.add(fineGrid, majorGrid);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa79e91, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(1.5, 2.4, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);
  }

  sync(
    model,
    selectedIds = this.selectedIds,
    selectedConnectionId = this.selectedConnectionId,
    selectedConnectionPointIndex = this.selectedConnectionPointIndex,
  ) {
    this.model = model;
    this.selectedIds = new Set(selectedIds);
    this.selectedConnectionId = selectedConnectionId;
    this.selectedConnectionPointIndex = selectedConnectionPointIndex;
    this.partsGroup.traverse((object) => object.geometry?.dispose?.());
    this.partsGroup.clear();
    this.connectionsGroup.traverse((object) => object.geometry?.dispose?.());
    this.connectionsGroup.clear();
    this.meshes.clear();
    model.parts.forEach((part) => this.createPart(part));
    model.connections?.forEach((connection) => this.createConnection(connection));
    this.repairBrokenCameraFocus();
    this.updateDimensions();
  }

  repairBrokenCameraFocus() {
    if (!this.partsGroup.children.length) return;
    const focusDistance = this.camera.position.distanceTo(this.controls.target);
    if (focusDistance > 0.06) return;

    const modelBounds = new THREE.Box3().setFromObject(this.partsGroup);
    if (modelBounds.isEmpty() || modelBounds.distanceToPoint(this.camera.position) < 0.08) return;

    const modelCenter = modelBounds.getCenter(new THREE.Vector3());
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const depthToModel = modelCenter.clone().sub(this.camera.position).dot(forward);
    if (!Number.isFinite(depthToModel) || depthToModel <= 0.08) return;

    // Keep the current viewing direction and only restore a sensible orbit/zoom
    // distance. This repairs persisted camera states without visibly jumping
    // the camera to the centre of the model.
    this.controls.target.copy(this.camera.position).addScaledVector(forward, depthToModel);
    this.controls.update();
  }

  createConnection(connection) {
    if (connection.type !== "confirmat") return;
    const placement = getConfirmatPlacement(this.model, connection);
    if (!placement) return;
    placement.points.forEach((point, pointIndex) => {
      const selected = connection.id === this.selectedConnectionId
        && (this.selectedConnectionPointIndex === null
          || this.selectedConnectionPointIndex === pointIndex);
      const material = selected ? this.selectedConfirmatMaterial : this.confirmatMaterial;
      const connectionData = { type: "connection", id: connection.id, pointIndex };
      const head = new THREE.Group();
      const headRadius = mmToWorld(5.5);
      const socketRadius = mmToWorld(2.45);
      const socketBottomRadius = mmToWorld(2.12);
      const headDepth = mmToWorld(1.8);
      const socketDepth = mmToWorld(1.35);

      // Build the head as a ring with a real hexagonal opening. Its front face
      // lies on the panel surface and all of its volume extends into the panel.
      const headShape = new THREE.Shape();
      headShape.absarc(0, 0, headRadius, 0, Math.PI * 2, false);
      const socketHole = new THREE.Path();
      for (let side = 0; side < 6; side += 1) {
        const angle = Math.PI / 6 + (side / 6) * Math.PI * 2;
        const x = Math.cos(angle) * socketRadius;
        const y = Math.sin(angle) * socketRadius;
        if (side === 0) socketHole.moveTo(x, y);
        else socketHole.lineTo(x, y);
      }
      socketHole.closePath();
      headShape.holes.push(socketHole);
      const ringGeometry = new THREE.ExtrudeGeometry(headShape, {
        depth: headDepth,
        bevelEnabled: false,
        curveSegments: 32,
      });
      ringGeometry.translate(0, 0, -headDepth);
      const ring = new THREE.Mesh(ringGeometry, material);
      ring.userData = connectionData;
      ring.castShadow = true;
      head.add(ring);

      // A dark inner wall and a hexagonal bottom make the socket visibly
      // recessed instead of looking like a flat marking on the screw head.
      // The panel itself has no CSG cut-out, so these inner faces intentionally
      // render over its front face while retaining their real inward positions.
      const socketWall = new THREE.Mesh(
        new THREE.CylinderGeometry(socketRadius, socketBottomRadius, socketDepth, 6, 1, true),
        this.confirmatSocketMaterial,
      );
      socketWall.rotation.x = Math.PI / 2;
      socketWall.position.z = -socketDepth / 2;
      socketWall.renderOrder = 2;
      socketWall.userData = connectionData;
      head.add(socketWall);

      const socketBottomShape = new THREE.Shape();
      for (let side = 0; side < 6; side += 1) {
        const angle = Math.PI / 6 + (side / 6) * Math.PI * 2;
        const x = Math.cos(angle) * socketBottomRadius;
        const y = Math.sin(angle) * socketBottomRadius;
        if (side === 0) socketBottomShape.moveTo(x, y);
        else socketBottomShape.lineTo(x, y);
      }
      socketBottomShape.closePath();
      const socketBottom = new THREE.Mesh(
        new THREE.ShapeGeometry(socketBottomShape),
        this.confirmatSocketBottomMaterial,
      );
      socketBottom.position.z = -socketDepth;
      socketBottom.renderOrder = 3;
      socketBottom.userData = connectionData;
      head.add(socketBottom);

      const outward = new THREE.Vector3(
        placement.axis === "x" ? placement.outerSide : 0,
        placement.axis === "y" ? placement.outerSide : 0,
        placement.axis === "z" ? placement.outerSide : 0,
      );
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
      head.userData.outward = outward.clone();
      head.userData.socketVisuals = [socketWall, socketBottom];
      const surfaceOffset = outward.clone().multiplyScalar(mmToWorld(0.02));
      head.position.set(
        mmToWorld(point.xMm) + surfaceOffset.x,
        mmToWorld(point.yMm) + surfaceOffset.y,
        mmToWorld(point.zMm) + surfaceOffset.z,
      );
      this.connectionsGroup.add(head);
    });
  }

  updateConfirmatSocketVisibility() {
    const headPosition = new THREE.Vector3();
    const direction = new THREE.Vector3();
    for (const head of this.connectionsGroup.children) {
      const outward = head.userData.outward;
      const socketVisuals = head.userData.socketVisuals;
      if (!outward || !socketVisuals) continue;

      head.getWorldPosition(headPosition);
      direction.copy(headPosition).sub(this.camera.position);
      const distanceToHead = direction.length();
      if (!distanceToHead) continue;
      direction.divideScalar(distanceToHead);

      // The forced-depth socket rendering is only valid while looking at its
      // exterior face. A ray check also prevents it from showing through a
      // different panel that happens to stand between the camera and the head.
      const facesCamera = direction.dot(outward) < 0;
      this.confirmatVisibilityRaycaster.set(this.camera.position, direction);
      this.confirmatVisibilityRaycaster.far = distanceToHead;
      const obstruction = this.confirmatVisibilityRaycaster
        .intersectObjects(this.partsGroup.children, true)
        .find((hit) => hit.distance < distanceToHead - mmToWorld(0.5));
      const visible = facesCamera && !obstruction;
      socketVisuals.forEach((visual) => {
        visual.visible = visible;
      });
    }
  }

  createPart(part) {
    const selected = this.selectedIds.has(part.id);
    const data = { type: "part", id: part.id };
    let root;
    if (part.hardwareType === "leg") {
      root = new THREE.Group();
      const material = selected ? this.selectedHardwareMaterial : this.hardwareMaterial;
      const addCylinder = (diameterMm, heightMm, yMm, partMaterial = material, segments = 28) => {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(mmToWorld(diameterMm / 2), mmToWorld(diameterMm / 2), mmToWorld(heightMm), segments),
          partMaterial,
        );
        mesh.position.y = mmToWorld(yMm);
        mesh.userData = data;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        root.add(mesh);
        return mesh;
      };
      addCylinder(57, 8, 46);
      addCylinder(42, 12, 36, selected ? material : this.hardwareAccentMaterial);
      addCylinder(29, 66, 0);
      addCylinder(37, 10, -35, selected ? material : this.hardwareAccentMaterial);
      addCylinder(48, 14, -43);
      for (let index = 0; index < 10; index += 1) {
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(mmToWorld(4), mmToWorld(11), mmToWorld(5)),
          selected ? material : this.hardwareAccentMaterial,
        );
        const angle = (index / 10) * Math.PI * 2;
        rib.position.set(Math.cos(angle) * mmToWorld(21), mmToWorld(-43), Math.sin(angle) * mmToWorld(21));
        rib.rotation.y = -angle;
        rib.userData = data;
        root.add(rib);
      }
    } else {
      const geometry = new THREE.BoxGeometry(
        mmToWorld(part.sizeX),
        mmToWorld(part.sizeY),
        mmToWorld(part.sizeZ),
      );
      root = new THREE.Mesh(geometry, selected ? this.selectedMaterial : this.partMaterial);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        selected ? this.selectedEdgeMaterial : this.edgeMaterial,
      );
      edges.userData = data;
      root.add(edges);
    }
    root.rotation.set(
      THREE.MathUtils.degToRad(part.rotationX),
      THREE.MathUtils.degToRad(part.rotationY),
      THREE.MathUtils.degToRad(part.rotationZ),
    );
    const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(root.rotation);
    const elements = rotationMatrix.elements;
    const worldHalfHeight = Math.abs(elements[1]) * mmToWorld(part.sizeX / 2)
      + Math.abs(elements[5]) * mmToWorld(part.sizeY / 2)
      + Math.abs(elements[9]) * mmToWorld(part.sizeZ / 2);
    root.position.set(
      mmToWorld(part.xMm),
      mmToWorld(part.yMm) + worldHalfHeight,
      mmToWorld(part.zMm),
    );
    root.userData = data;
    root.castShadow = true;
    root.receiveShadow = true;
    this.partsGroup.add(root);
    this.meshes.set(part.id, root);
  }

  updatePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  pickHardwareByScreen(event) {
    if (!this.model) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const padding = 8;
    const candidates = [];
    this.model.parts.filter((part) => part.kind === "hardware").forEach((part) => {
      const root = this.meshes.get(part.id);
      if (!root) return;
      root.updateWorldMatrix(true, true);
      const visibleMeshes = [];
      root.traverse((object) => {
        if (object.isMesh) visibleMeshes.push(object);
      });
      if (!visibleMeshes.some((mesh) => this.screenPointHitsObject(event, mesh, 1))) return;
      const box = new THREE.Box3().setFromObject(root);
      const points = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const projected = new THREE.Vector3(x, y, z).project(this.camera);
            if (projected.z < -1 || projected.z > 1) continue;
            points.push({
              x: (projected.x * 0.5 + 0.5) * rect.width,
              y: (-projected.y * 0.5 + 0.5) * rect.height,
            });
          }
        }
      }
      if (!points.length) return;
      const minX = Math.min(...points.map((point) => point.x)) - padding;
      const maxX = Math.max(...points.map((point) => point.x)) + padding;
      const minY = Math.min(...points.map((point) => point.y)) - padding;
      const maxY = Math.max(...points.map((point) => point.y)) + padding;
      if (mouseX < minX || mouseX > maxX || mouseY < minY || mouseY > maxY) return;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      candidates.push({
        id: part.id,
        screenDistance: Math.hypot(mouseX - centerX, mouseY - centerY),
      });
    });
    candidates.sort((first, second) => first.screenDistance - second.screenDistance);
    return candidates[0] ? { type: "part", id: candidates[0].id } : null;
  }

  screenPointHitsObject(event, root, edgeTolerancePx = 3) {
    if (!root) return false;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const points = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(this.camera);
          if (projected.z < -1 || projected.z > 1) continue;
          points.push({
            x: (projected.x * 0.5 + 0.5) * rect.width,
            y: (-projected.y * 0.5 + 0.5) * rect.height,
          });
        }
      }
    }
    if (points.length < 3) return false;
    const sorted = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
    const cross = (origin, first, second) => (
      (first.x - origin.x) * (second.y - origin.y)
      - (first.y - origin.y) * (second.x - origin.x)
    );
    const lower = [];
    sorted.forEach((point) => {
      while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
      lower.push(point);
    });
    const upper = [];
    [...sorted].reverse().forEach((point) => {
      while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
      upper.push(point);
    });
    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    let inside = false;
    for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index, index += 1) {
      const currentPoint = hull[index];
      const previousPoint = hull[previous];
      if (
        (currentPoint.y > pointer.y) !== (previousPoint.y > pointer.y)
        && pointer.x < (
          (previousPoint.x - currentPoint.x) * (pointer.y - currentPoint.y)
          / (previousPoint.y - currentPoint.y) + currentPoint.x
        )
      ) inside = !inside;
    }
    if (inside) return true;
    const distanceToSegment = (point, start, end) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared
        ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
        : 0;
      return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
    };
    return hull.some((point, index) => (
      distanceToSegment(pointer, point, hull[(index + 1) % hull.length]) <= edgeTolerancePx
    ));
  }

  pick(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.partsGroup.children, true);
    const nearestPartSurface = hits.find((item) => item.object?.userData?.type === "part");
    const connectionHit = this.raycaster.intersectObjects(this.connectionsGroup.children, true)
      .find((item) => item.object?.userData?.type === "connection");
    if (
      connectionHit
      && (!nearestPartSurface || connectionHit.distance <= nearestPartSurface.distance + mmToWorld(2))
    ) return connectionHit.object.userData;
    const hardware = this.pickHardwareByScreen(event);
    if (hardware) return hardware;
    const nearest = hits.find((item) => {
      const data = item.object?.userData;
      return data?.type === "part"
        && this.screenPointHitsObject(event, this.meshes.get(data.id));
    });
    const nearbyHardware = nearest && hits.find((item) => {
      const data = item.object?.userData;
      const part = data?.type === "part" ? this.model?.getPart(data.id) : null;
      return part?.kind === "hardware"
        && item.distance <= nearest.distance + mmToWorld(120);
    });
    const hit = nearbyHardware ?? nearest;
    return hit?.object?.userData?.type === "part" ? hit.object.userData : null;
  }

  groundPoint(event, yMm = 0) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.dragPlane.constant = -mmToWorld(yMm);
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint);
    return hit ? { xMm: Math.round(worldToMm(hit.x)), zMm: Math.round(worldToMm(hit.z)) } : null;
  }

  confirmatDragValue(event, connection) {
    const placement = getConfirmatPlacement(this.model, connection);
    if (!placement) return null;
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const normal = new THREE.Vector3(
      placement.axis === "x" ? 1 : 0,
      placement.axis === "y" ? 1 : 0,
      placement.axis === "z" ? 1 : 0,
    );
    const plane = new THREE.Plane(normal, -mmToWorld(placement.surface));
    const hit = this.raycaster.ray.intersectPlane(plane, this.dragPoint);
    return hit ? Math.round(worldToMm(hit[placement.spanAxis])) : null;
  }

  measurePoint(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.partsGroup.children, true)
      .find((item) => item.object?.isMesh);
    if (hit) {
      return {
        xMm: Math.round(worldToMm(hit.point.x)),
        yMm: Math.round(worldToMm(hit.point.y)),
        zMm: Math.round(worldToMm(hit.point.z)),
      };
    }
    this.dragPlane.constant = 0;
    const ground = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint);
    return ground ? {
      xMm: Math.round(worldToMm(ground.x)),
      yMm: 0,
      zMm: Math.round(worldToMm(ground.z)),
    } : null;
  }

  setMeasurement(points = []) {
    this.measurement = points.map((point) => ({ ...point }));
    this.updateDimensions();
  }

  setOrientationEditor(partId = null) {
    this.orientationPartId = partId;
    this.updateDimensions();
  }

  setControlsEnabled(enabled) {
    this.controls.enabled = enabled;
  }

  panCameraScreen(horizontal, vertical, deltaSeconds) {
    if (!horizontal && !vertical) return;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const screenUp = new THREE.Vector3().crossVectors(right, forward).normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(0.12, distance * 0.9) * deltaSeconds;
    const movement = right.multiplyScalar(horizontal * speed)
      .add(screenUp.multiplyScalar(vertical * speed));
    this.camera.position.add(movement);
    this.controls.target.add(movement);
    this.controls.update();
    this.updateDimensions();
  }

  setView(mode) {
    this.viewMode = mode;
    if (mode === "top") {
      this.camera.position.set(0, 2.2, 0.001);
      this.camera.up.set(0, 0, -1);
      this.controls.target.set(0, 0, 0);
      this.controls.enableRotate = false;
    } else {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(1.25, 0.95, 1.25);
      this.controls.target.set(0, 0.25, 0);
      this.controls.enableRotate = true;
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.updateDimensions();
  }

  getViewState() {
    return {
      mode: this.viewMode,
      camera: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
    };
  }

  restoreViewState(state) {
    if (!state || !Array.isArray(state.camera) || !Array.isArray(state.target)) return;
    this.viewMode = state.mode === "top" ? "top" : "3d";
    this.camera.up.set(0, this.viewMode === "top" ? 0 : 1, this.viewMode === "top" ? -1 : 0);
    this.controls.enableRotate = this.viewMode !== "top";
    this.camera.position.fromArray(state.camera);
    this.controls.target.fromArray(state.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.updateDimensions();
  }

  project(xMm, yMm, zMm) {
    const point = new THREE.Vector3(mmToWorld(xMm), mmToWorld(yMm), mmToWorld(zMm)).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (point.x * 0.5 + 0.5) * rect.width,
      y: (-point.y * 0.5 + 0.5) * rect.height,
      visible: point.z > -1 && point.z < 1,
    };
  }

  addDimension(text, xMm, yMm, zMm, className = "") {
    const point = this.project(xMm, yMm, zMm);
    if (!point.visible) return;
    const label = document.createElement("span");
    label.className = `dimension-label ${className}`;
    label.textContent = `${Math.round(text).toLocaleString("ru-RU")} мм`;
    label.style.left = `${point.x}px`;
    label.style.top = `${point.y}px`;
    this.dimensionLayer.append(label);
  }

  addPartDimensionGuide(start, end, text, className = "") {
    const from = this.project(start.xMm, start.yMm, start.zMm);
    const to = this.project(end.xMm, end.yMm, end.zMm);
    if (!from.visible || !to.visible) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const guide = document.createElement("span");
    guide.className = `part-dimension-guide ${className}`;
    guide.style.left = `${from.x}px`;
    guide.style.top = `${from.y}px`;
    guide.style.width = `${Math.hypot(dx, dy)}px`;
    const angle = Math.atan2(dy, dx);
    guide.style.transform = `rotate(${angle}rad)`;
    const label = document.createElement("b");
    label.textContent = `${Math.round(text).toLocaleString("ru-RU")} мм`;
    const readableFlip = angle > Math.PI / 2 || angle < -Math.PI / 2 ? Math.PI : 0;
    label.style.transform = `translate(-50%, -50%) rotate(${readableFlip}rad)`;
    guide.append(label);
    this.dimensionLayer.append(guide);
  }

  localPartPoint(root, xMm, yMm, zMm) {
    const point = root.localToWorld(new THREE.Vector3(
      mmToWorld(xMm),
      mmToWorld(yMm),
      mmToWorld(zMm),
    ));
    return {
      xMm: worldToMm(point.x),
      yMm: worldToMm(point.y),
      zMm: worldToMm(point.z),
    };
  }

  addOrientationControls(part, root, faceY) {
    const center = this.project(...Object.values(this.localPartPoint(root, 0, faceY, 0)));
    if (!center.visible) return;
    const faceSide = faceY >= 0 ? 1 : -1;
    const face = document.createElement("button");
    face.type = "button";
    face.className = `orientation-control orientation-face${part.faceSide === faceSide ? " selected" : ""}`;
    face.dataset.orientationPart = part.id;
    face.dataset.faceSide = String(faceSide);
    face.title = "Назначить эту сторону лицевой";
    face.style.left = `${center.x}px`;
    face.style.top = `${center.y}px`;
    face.style.transform = "translate(-50%, -50%)";
    this.dimensionLayer.append(face);

    const offsetX = Math.max(10, part.sizeX / 2 - Math.min(38, part.sizeX * 0.18));
    const offsetZ = Math.max(10, part.sizeZ / 2 - Math.min(38, part.sizeZ * 0.18));
    const spreadX = Math.min(62, part.sizeX * 0.16);
    const spreadZ = Math.min(62, part.sizeZ * 0.16);
    const directions = [
      { key: "x+", vector: { x: 1, z: 0 }, points: [-spreadZ, 0, spreadZ].map((z) => ({ x: offsetX, z })) },
      { key: "x-", vector: { x: -1, z: 0 }, points: [-spreadZ, 0, spreadZ].map((z) => ({ x: -offsetX, z })) },
      { key: "z+", vector: { x: 0, z: 1 }, points: [-spreadX, 0, spreadX].map((x) => ({ x, z: offsetZ })) },
      { key: "z-", vector: { x: 0, z: -1 }, points: [-spreadX, 0, spreadX].map((x) => ({ x, z: -offsetZ })) },
    ];
    directions.forEach((direction) => {
      const referenceMm = this.localPartPoint(
        root,
        direction.vector.x * 60,
        faceY,
        direction.vector.z * 60,
      );
      const reference = this.project(referenceMm.xMm, referenceMm.yMm, referenceMm.zMm);
      const directionAngle = Math.atan2(reference.y - center.y, reference.x - center.x);
      direction.points.forEach((localPoint) => {
        const pointMm = this.localPartPoint(root, localPoint.x, faceY, localPoint.z);
        const point = this.project(pointMm.xMm, pointMm.yMm, pointMm.zMm);
        if (!point.visible) return;
        const arrow = document.createElement("button");
        arrow.type = "button";
        arrow.className = `orientation-control orientation-arrow${part.frontDirection === direction.key ? " selected" : ""}`;
        arrow.dataset.orientationPart = part.id;
        arrow.dataset.frontDirection = direction.key;
        arrow.title = "Назначить это направление передом";
        arrow.innerHTML = `
          <svg viewBox="0 0 34 24" aria-hidden="true">
            <line class="arrow-shaft" x1="3" y1="12" x2="23" y2="12"></line>
            <path class="arrow-head" d="M18 5 L31 12 L18 19 Z"></path>
          </svg>
        `;
        arrow.style.left = `${point.x}px`;
        arrow.style.top = `${point.y}px`;
        arrow.style.transform = `translate(-50%, -50%) rotate(${directionAngle}rad)`;
        this.dimensionLayer.append(arrow);
      });
    });
  }

  updateDimensions() {
    this.dimensionLayer.replaceChildren();
    if (this.measurement.length) {
      const start = this.project(
        this.measurement[0].xMm,
        this.measurement[0].yMm,
        this.measurement[0].zMm,
      );
      if (start.visible && this.measurement.length === 1) {
        const marker = document.createElement("span");
        marker.className = "measurement-point";
        marker.style.left = `${start.x}px`;
        marker.style.top = `${start.y}px`;
        this.dimensionLayer.append(marker);
      }
      if (start.visible && this.measurement.length === 2) {
        const end = this.project(
          this.measurement[1].xMm,
          this.measurement[1].yMm,
          this.measurement[1].zMm,
        );
        if (end.visible) {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const line = document.createElement("span");
          line.className = "measurement-line";
          line.style.left = `${start.x}px`;
          line.style.top = `${start.y}px`;
          line.style.width = `${Math.hypot(dx, dy)}px`;
          line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
          const dxMm = this.measurement[1].xMm - this.measurement[0].xMm;
          const dyMm = this.measurement[1].yMm - this.measurement[0].yMm;
          const dzMm = this.measurement[1].zMm - this.measurement[0].zMm;
          const distanceMm = Math.round(Math.hypot(dxMm, dyMm, dzMm));
          const label = document.createElement("span");
          label.className = "measurement-label";
          label.textContent = `${distanceMm.toLocaleString("ru-RU")} мм`;
          label.style.left = `${(start.x + end.x) / 2}px`;
          label.style.top = `${(start.y + end.y) / 2 - 14}px`;
          this.dimensionLayer.append(line, label);
        }
      }
    }
    if (!this.model || this.selectedIds.size !== 1) return;
    const part = this.model.getPart([...this.selectedIds][0]);
    if (!part) return;
    const root = this.meshes.get(part.id);
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const cameraLocal = root.worldToLocal(this.camera.position.clone());
    const halfX = part.sizeX / 2;
    const halfY = part.sizeY / 2;
    const halfZ = part.sizeZ / 2;
    const faceX = cameraLocal.x >= 0 ? halfX : -halfX;
    const faceY = cameraLocal.y >= 0 ? halfY : -halfY;
    const faceZ = cameraLocal.z >= 0 ? halfZ : -halfZ;
    const insideX = faceX - Math.sign(faceX || 1) * Math.min(22, halfX * 0.12);
    const insideZ = faceZ - Math.sign(faceZ || 1) * Math.min(22, halfZ * 0.12);
    this.addPartDimensionGuide(
      this.localPartPoint(root, -halfX, faceY, insideZ),
      this.localPartPoint(root, halfX, faceY, insideZ),
      part.sizeX,
      "size-x",
    );
    const thicknessOnXFace = Math.abs(cameraLocal.x) >= Math.abs(cameraLocal.z);
    this.addPartDimensionGuide(
      thicknessOnXFace
        ? this.localPartPoint(root, faceX, -halfY, insideZ)
        : this.localPartPoint(root, insideX, -halfY, faceZ),
      thicknessOnXFace
        ? this.localPartPoint(root, faceX, halfY, insideZ)
        : this.localPartPoint(root, insideX, halfY, faceZ),
      part.sizeY,
      "size-y",
    );
    this.addPartDimensionGuide(
      this.localPartPoint(root, insideX, faceY, -halfZ),
      this.localPartPoint(root, insideX, faceY, halfZ),
      part.sizeZ,
      "size-z",
    );
    if (this.orientationPartId === part.id && part.kind !== "hardware") {
      this.addOrientationControls(part, root, faceY);
    }
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
    this.updateDimensions();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.updateConfirmatSocketVisibility();
    this.updateDimensions();
    this.renderer.render(this.scene, this.camera);
  }
}
