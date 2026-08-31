import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { formatMm, mmToWorld, worldToMm } from "../core/units.js";
import { getCameraFacingWallSurface, getWallDimensionSpan, isWallPositiveFaceVisible } from "../geometry/polygon.js";

const COLORS = {
  wall: 0xf7f7f4,
  selected: 0x8fc8e8,
  edge: 0x53616c,
  selectedEdge: 0x197fb8,
  point: 0x485864,
  firstPoint: 0x197fb8,
  floor: 0xe8e3d8,
  preview: 0x238ec7,
};

export class SceneManager {
  constructor(canvas, dimensionLayer) {
    this.canvas = canvas;
    this.dimensionLayer = dimensionLayer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcfe3f1);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.wallGroup = new THREE.Group();
    this.windowGroup = new THREE.Group();
    this.pointGroup = new THREE.Group();
    this.floorGroup = new THREE.Group();
    this.previewGroup = new THREE.Group();
    this.handleGroup = new THREE.Group();
    this.scene.add(this.floorGroup, this.wallGroup, this.windowGroup, this.pointGroup, this.previewGroup, this.handleGroup);
    this.wallMeshes = new Map();
    this.windowMeshes = new Map();
    this.pointMeshes = new Map();
    this.room = null;
    this.selectedWallId = null;
    this.selectedWindowId = null;
    this.selectedWallIds = new Set();
    this.selectedWindowIds = new Set();
    this.resizeWallId = null;
    this.resizeWindowId = null;
    this.preview = null;
    this.viewMode = "3d";
    this.gridVisible = true;
    this.lastGridStep = null;

    this.wallMaterial = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.92, metalness: 0 });
    this.selectedWallMaterial = new THREE.MeshStandardMaterial({ color: COLORS.selected, roughness: 0.86 });
    this.wallEdgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.72 });
    this.selectedEdgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.selectedEdge });
    this.pointMaterial = new THREE.MeshBasicMaterial({ color: COLORS.point });
    this.firstPointMaterial = new THREE.MeshBasicMaterial({ color: COLORS.firstPoint });
    this.previewMaterial = new THREE.MeshBasicMaterial({ color: COLORS.preview, transparent: true, opacity: 0.42, depthWrite: false });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 1, side: THREE.DoubleSide });
    this.windowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x9fd4e7,
      transparent: false,
      opacity: 1,
      roughness: 0.16,
      metalness: 0.04,
      clearcoat: 0.8,
      clearcoatRoughness: 0.22,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.selectedWindowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x62b9dc,
      transparent: false,
      opacity: 1,
      roughness: 0.12,
      clearcoat: 0.9,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fafb, roughness: 0.38 });
    this.windowRecessMaterial = new THREE.MeshStandardMaterial({
      color: 0x739baa,
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.windowGasketMaterial = new THREE.MeshStandardMaterial({ color: 0x4d5b63, roughness: 0.72 });
    this.windowHandleMaterial = new THREE.MeshStandardMaterial({ color: 0xe7ebed, roughness: 0.32, metalness: 0.12 });
    this.doorHitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.handleMaterial = new THREE.MeshBasicMaterial({
      color: 0x087fc0,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });

    this.groundSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 1, metalness: 0 }),
    );
    this.groundSurface.rotation.x = -Math.PI / 2;
    this.groundSurface.position.y = -0.012;
    this.groundSurface.receiveShadow = true;
    this.scene.add(this.groundSurface);

    this.createCameras();
    this.createLights();
    this.axes = new THREE.AxesHelper(1.2);
    this.scene.add(this.axes);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.animate();
  }

  createCameras() {
    this.topCamera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.01, 200);
    this.topCamera.position.set(0, 12, 0);
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.lookAt(0, 0, 0);
    this.perspectiveCamera = new THREE.PerspectiveCamera(48, 1, 0.01, 300);
    this.perspectiveCamera.position.set(7, 7, 7);
    this.camera = this.perspectiveCamera;

    this.topControls = new OrbitControls(this.topCamera, this.canvas);
    this.topControls.enableRotate = false;
    this.topControls.enableDamping = true;
    this.topControls.dampingFactor = 0.12;
    this.topControls.zoomToCursor = true;
    this.topControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.topControls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.topControls.enabled = false;
    this.perspectiveControls = new OrbitControls(this.perspectiveCamera, this.canvas);
    this.perspectiveControls.enableDamping = true;
    this.perspectiveControls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.perspectiveControls.target.set(0, 1, 0);
    this.perspectiveControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.perspectiveControls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.perspectiveControls.enabled = true;
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8afa0, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.1);
    light.position.set(5, 9, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -12;
    light.shadow.camera.right = 12;
    light.shadow.camera.top = 12;
    light.shadow.camera.bottom = -12;
    this.scene.add(light);
  }

  setControlsEnabled(enabled) {
    const drawing = !enabled;
    this.topControls.enablePan = !drawing;
    this.perspectiveControls.enablePan = !drawing;
    this.perspectiveControls.enableRotate = !drawing;
  }

  setView(mode) {
    this.viewMode = mode;
    this.camera = mode === "top" ? this.topCamera : this.perspectiveCamera;
    this.topControls.enabled = mode === "top";
    this.perspectiveControls.enabled = mode === "3d";
    this.pointGroup.visible = mode === "top";
    this.handleGroup.visible = mode === "3d";
    this.axes.visible = true;
    this.resize();
  }

  setGridVisible(visible) {
    this.gridVisible = visible;
    if (this.grid) this.grid.visible = visible;
  }

  updateGrid(stepMm) {
    if (this.lastGridStep === stepMm && this.grid) return;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const stepWorld = mmToWorld(stepMm);
    const size = 60;
    const divisions = Math.min(600, Math.max(20, Math.round(size / stepWorld)));
    this.grid = new THREE.GridHelper(size, divisions, 0x8797a3, 0xc4cbd0);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.72;
    this.grid.visible = this.gridVisible;
    this.scene.add(this.grid);
    this.lastGridStep = stepMm;
  }

  syncRoom(room, selectedWallId = null, selectedWindowId = this.selectedWindowId) {
    this.room = room;
    this.selectedWallId = selectedWallId;
    this.selectedWindowId = selectedWindowId;
    this.updateGrid(room.gridStepMm);
    this.clearGroup(this.wallGroup);
    this.clearGroup(this.windowGroup);
    this.clearGroup(this.pointGroup);
    this.clearGroup(this.floorGroup);
    this.clearGroup(this.handleGroup);
    this.wallMeshes.clear();
    this.windowMeshes.clear();
    this.pointMeshes.clear();

    room.walls.forEach((wall) => this.createWallMesh(wall));
    room.windows.forEach((item) => this.createWindowMesh(item));
    const resizeWall = this.resizeWallId ? room.getWall(this.resizeWallId) : null;
    if (resizeWall) this.createResizeHandles(resizeWall);
    const resizeWindow = this.resizeWindowId ? room.getWindow(this.resizeWindowId) : null;
    if (resizeWindow) this.createWindowResizeHandles(resizeWindow);
    room.points.forEach((point, index) => this.createPointMesh(point, index === 0));
    if (room.isClosed) this.createFloor(room.getOrderedContourPoints());
    this.pointGroup.visible = this.viewMode === "top";
    this.handleGroup.visible = this.viewMode === "3d";
    this.updateDimensions();
  }

  createWallMesh(wall) {
    const { start, end } = this.room.getWallPoints(wall);
    const dx = end.xMm - start.xMm;
    const dz = end.zMm - start.zMm;
    const length = Math.hypot(dx, dz);
    const heightMm = this.room.getWallHeight(wall);
    const thicknessMm = this.room.getWallThickness(wall);
    const width = mmToWorld(length);
    const height = mmToWorld(heightMm);
    const thickness = mmToWorld(thicknessMm);
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -height / 2);
    shape.lineTo(width / 2, -height / 2);
    shape.lineTo(width / 2, height / 2);
    shape.lineTo(-width / 2, height / 2);
    shape.closePath();
    this.room.windows.filter((item) => item.wallId === wall.id).forEach((item) => {
      const left = mmToWorld(item.offsetMm - item.widthMm / 2) - width / 2;
      const right = mmToWorld(item.offsetMm + item.widthMm / 2) - width / 2;
      const bottom = mmToWorld(item.kind === "door" ? 1 : item.sillHeightMm) - height / 2;
      const top = mmToWorld(item.sillHeightMm + item.heightMm) - height / 2;
      const opening = new THREE.Path();
      opening.moveTo(left, bottom);
      opening.lineTo(left, top);
      opening.lineTo(right, top);
      opening.lineTo(right, bottom);
      opening.closePath();
      shape.holes.push(opening);
    });
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -thickness / 2);
    const wallSelected = wall.id === this.selectedWallId || this.selectedWallIds.has(wall.id);
    const material = wallSelected ? this.selectedWallMaterial : this.wallMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    const normalX = length > 0 ? -dz / length : 0;
    const normalZ = length > 0 ? dx / length : 0;
    const centerX = (start.xMm + end.xMm) / 2 + normalX * (thicknessMm / 2);
    const centerZ = (start.zMm + end.zMm) / 2 + normalZ * (thicknessMm / 2);
    mesh.position.set(mmToWorld(centerX), mmToWorld(heightMm / 2), mmToWorld(centerZ));
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.userData = { type: "wall", id: wall.id };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      wallSelected ? this.selectedEdgeMaterial : this.wallEdgeMaterial,
    );
    mesh.add(edges);
    this.wallGroup.add(mesh);
    this.wallMeshes.set(wall.id, mesh);
  }

  createPointMesh(point, first) {
    const geometry = new THREE.SphereGeometry(0.065, 18, 12);
    const mesh = new THREE.Mesh(geometry, first ? this.firstPointMaterial : this.pointMaterial);
    mesh.position.set(mmToWorld(point.xMm), 0.075, mmToWorld(point.zMm));
    mesh.userData = { type: "point", id: point.id };
    this.pointGroup.add(mesh);
    this.pointMeshes.set(point.id, mesh);
  }

  getWindowTransform(item) {
    const wall = this.room.getWall(item.wallId);
    const { start, end } = this.room.getWallPoints(wall);
    const dx = end.xMm - start.xMm;
    const dz = end.zMm - start.zMm;
    const length = Math.hypot(dx, dz);
    const axisX = dx / length;
    const axisZ = dz / length;
    const normalX = -axisZ;
    const normalZ = axisX;
    const surfaceOffset = this.room.getWallThickness(wall);
    return {
      wall, start, end, length, axisX, axisZ, normalX, normalZ,
      xMm: start.xMm + axisX * item.offsetMm + normalX * surfaceOffset,
      zMm: start.zMm + axisZ * item.offsetMm + normalZ * surfaceOffset,
      angle: -Math.atan2(dz, dx),
    };
  }

  createWindowMesh(item) {
    const transform = this.getWindowTransform(item);
    if (!transform?.wall) return;
    const group = new THREE.Group();
    const insetMm = Math.min(this.room.gridStepMm, this.room.getWallThickness(transform.wall));
    group.position.set(
      mmToWorld(transform.xMm - transform.normalX * insetMm),
      mmToWorld(item.sillHeightMm + item.heightMm / 2),
      mmToWorld(transform.zMm - transform.normalZ * insetMm),
    );
    group.rotation.y = transform.angle;
    const selected = item.id === this.selectedWindowId || this.selectedWindowIds.has(item.id);
    const data = { type: "window", id: item.id };
    const width = mmToWorld(item.widthMm);
    const height = mmToWorld(item.heightMm);
    const outerProfile = Math.min(0.075, width * 0.11, height * 0.11);
    const sashProfile = Math.max(0.024, outerProfile * 0.56);
    const wallDepth = mmToWorld(this.room.getWallThickness(transform.wall));
    const frameDepth = Math.min(0.07, mmToWorld(this.room.gridStepMm) * 0.7, wallDepth / 2);
    const doubleSash = width >= 0.8;

    const addBox = (boxWidth, boxHeight, depth, x, y, z, material = this.windowFrameMaterial) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, boxHeight, depth), material);
      part.position.set(x, y, z);
      part.userData = data;
      part.castShadow = false;
      part.receiveShadow = false;
      group.add(part);
      return part;
    };

    if (item.kind === "door") {
      const profile = Math.min(0.075, width * 0.12, height * 0.08);
      addBox(width, profile, frameDepth, 0, height / 2 - profile / 2, 0);
      addBox(profile, height - profile, frameDepth, width / 2 - profile / 2, -profile / 2, 0);
      addBox(profile, height - profile, frameDepth, -width / 2 + profile / 2, -profile / 2, 0);
      addBox(
        Math.max(0.02, width - profile * 2),
        Math.max(0.02, height - profile),
        0.004,
        0,
        -profile / 2,
        0,
        this.doorHitMaterial,
      );
      if (selected) {
        const outlineSource = new THREE.BoxGeometry(width, height, frameDepth + 0.004);
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(outlineSource),
          this.selectedEdgeMaterial,
        );
        outlineSource.dispose();
        outline.userData = data;
        group.add(outline);
      }
      this.windowGroup.add(group);
      this.windowMeshes.set(item.id, group);
      return;
    }

    // One symmetric PVC construction sits inside the wall opening.
    addBox(width, outerProfile, frameDepth, 0, height / 2 - outerProfile / 2, 0);
    addBox(width, outerProfile, frameDepth, 0, -height / 2 + outerProfile / 2, 0);
    addBox(outerProfile, height - outerProfile * 2, frameDepth, width / 2 - outerProfile / 2, 0, 0);
    addBox(outerProfile, height - outerProfile * 2, frameDepth, -width / 2 + outerProfile / 2, 0, 0);

    const innerWidth = Math.max(0.05, width - outerProfile * 2);
    const innerHeight = Math.max(0.05, height - outerProfile * 2);
    const mullionWidth = doubleSash ? Math.min(0.07, outerProfile) : 0;
    if (doubleSash) addBox(mullionWidth, innerHeight, frameDepth * 0.94, 0, 0, 0);

    const sectionWidth = doubleSash ? (innerWidth - mullionWidth) / 2 : innerWidth;
    const centers = doubleSash
      ? [-(mullionWidth + sectionWidth) / 2, (mullionWidth + sectionWidth) / 2]
      : [0];
    const glassMaterial = selected ? this.selectedWindowMaterial : this.windowMaterial;

    centers.forEach((centerX) => {
      const glassWidth = Math.max(0.02, sectionWidth - sashProfile * 2);
      const glassHeight = Math.max(0.02, innerHeight - sashProfile * 2);

      // Thin rubber seal around each insulated glass unit.
      addBox(sectionWidth, sashProfile + 0.012, 0.018, centerX, innerHeight / 2 - sashProfile / 2, 0, this.windowGasketMaterial);
      addBox(sectionWidth, sashProfile + 0.012, 0.018, centerX, -innerHeight / 2 + sashProfile / 2, 0, this.windowGasketMaterial);
      addBox(sashProfile + 0.012, innerHeight, 0.018, centerX - sectionWidth / 2 + sashProfile / 2, 0, 0, this.windowGasketMaterial);
      addBox(sashProfile + 0.012, innerHeight, 0.018, centerX + sectionWidth / 2 - sashProfile / 2, 0, 0, this.windowGasketMaterial);

      // Raised white sash profile and inset glass.
      addBox(sectionWidth, sashProfile, 0.034, centerX, innerHeight / 2 - sashProfile / 2, 0);
      addBox(sectionWidth, sashProfile, 0.034, centerX, -innerHeight / 2 + sashProfile / 2, 0);
      addBox(sashProfile, innerHeight - sashProfile * 2, 0.034, centerX - sectionWidth / 2 + sashProfile / 2, 0, 0);
      addBox(sashProfile, innerHeight - sashProfile * 2, 0.034, centerX + sectionWidth / 2 - sashProfile / 2, 0, 0);
      addBox(glassWidth, glassHeight, 0.012, centerX, 0, 0, glassMaterial);
    });

    // Familiar vertical handle on the active sash.
    if (width >= 0.65 && height >= 0.55) {
      const handleX = doubleSash ? mullionWidth / 2 + sashProfile * 0.9 : width / 2 - outerProfile - sashProfile * 1.2;
      const handleZ = frameDepth / 2 + 0.01;
      addBox(0.038, 0.11, 0.018, handleX, 0, handleZ, this.windowHandleMaterial);
      addBox(0.035, 0.17, 0.026, handleX + 0.025, -0.045, handleZ + 0.009, this.windowHandleMaterial);
      addBox(0.038, 0.11, 0.018, handleX, 0, -handleZ, this.windowHandleMaterial);
      addBox(0.035, 0.17, 0.026, handleX + 0.025, -0.045, -handleZ - 0.009, this.windowHandleMaterial);
    }

    if (selected) {
      const outlineSource = new THREE.BoxGeometry(width, height, frameDepth + 0.004);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(outlineSource),
        this.selectedEdgeMaterial,
      );
      outlineSource.dispose();
      outline.position.z = 0;
      outline.userData = data;
      group.add(outline);
    }
    this.windowGroup.add(group);
    this.windowMeshes.set(item.id, group);
  }

  createResizeHandles(wall) {
    const { start, end } = this.room.getWallPoints(wall);
    const dx = end.xMm - start.xMm;
    const dz = end.zMm - start.zMm;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const heightMm = this.room.getWallHeight(wall);
    const thicknessMm = this.room.getWallThickness(wall);
    const axis = new THREE.Vector3(dx / length, 0, dz / length);
    const normalX = -dz / length;
    const normalZ = dx / length;
    const sideOffsetX = normalX * (thicknessMm / 2);
    const sideOffsetZ = normalZ * (thicknessMm / 2);
    const y = mmToWorld(heightMm / 2);

    this.createArrowHandle(
      { type: "resize-handle", ownerType: "wall", ownerId: wall.id, action: "length-start" },
      new THREE.Vector3(mmToWorld(start.xMm + sideOffsetX), y, mmToWorld(start.zMm + sideOffsetZ)),
      axis.clone().multiplyScalar(-1),
    );
    this.createArrowHandle(
      { type: "resize-handle", ownerType: "wall", ownerId: wall.id, action: "length-end" },
      new THREE.Vector3(mmToWorld(end.xMm + sideOffsetX), y, mmToWorld(end.zMm + sideOffsetZ)),
      axis,
    );
    this.createArrowHandle(
      { type: "resize-handle", ownerType: "wall", ownerId: wall.id, action: "height" },
      new THREE.Vector3(
        mmToWorld((start.xMm + end.xMm) / 2 + sideOffsetX),
        mmToWorld(heightMm),
        mmToWorld((start.zMm + end.zMm) / 2 + sideOffsetZ),
      ),
      new THREE.Vector3(0, 1, 0),
    );
  }

  createWindowResizeHandles(item) {
    const transform = this.getWindowTransform(item);
    const axis = new THREE.Vector3(transform.axisX, 0, transform.axisZ);
    const center = new THREE.Vector3(
      mmToWorld(transform.xMm),
      mmToWorld(item.sillHeightMm + item.heightMm / 2),
      mmToWorld(transform.zMm),
    );
    const halfWidth = mmToWorld(item.widthMm / 2);
    this.createArrowHandle(
      { type: "resize-handle", ownerType: "window", ownerId: item.id, action: "width-start" },
      center.clone().add(axis.clone().multiplyScalar(-halfWidth)),
      axis.clone().multiplyScalar(-1),
    );
    this.createArrowHandle(
      { type: "resize-handle", ownerType: "window", ownerId: item.id, action: "width-end" },
      center.clone().add(axis.clone().multiplyScalar(halfWidth)),
      axis,
    );
    this.createArrowHandle(
      { type: "resize-handle", ownerType: "window", ownerId: item.id, action: "height" },
      new THREE.Vector3(mmToWorld(transform.xMm), mmToWorld(item.sillHeightMm + item.heightMm), mmToWorld(transform.zMm)),
      new THREE.Vector3(0, 1, 0),
    );
  }

  createArrowHandle(data, origin, direction) {
    const group = new THREE.Group();
    group.position.copy(origin);
    group.renderOrder = 20;
    const shaftLength = 0.48;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, shaftLength, 14), this.handleMaterial);
    shaft.position.copy(direction).multiplyScalar(shaftLength / 2);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    shaft.userData = data;
    shaft.renderOrder = 100;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 18), this.handleMaterial);
    tip.position.copy(direction).multiplyScalar(shaftLength + 0.12);
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    tip.userData = data;
    tip.renderOrder = 100;
    group.add(shaft, tip);
    this.handleGroup.add(group);
  }

  createFloor(points) {
    if (points.length < 3) return;
    const shape = new THREE.Shape();
    shape.moveTo(mmToWorld(points[0].xMm), mmToWorld(points[0].zMm));
    points.slice(1).forEach((point) => shape.lineTo(mmToWorld(point.xMm), mmToWorld(point.zMm)));
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const floor = new THREE.Mesh(geometry, this.floorMaterial);
    floor.rotation.x = Math.PI / 2;
    floor.position.y = 0.005;
    floor.userData = { type: "floor" };
    this.floorGroup.add(floor);
  }

  setPreview(start, end, snapKind = null) {
    this.preview = start && end ? { start, end, snapKind } : null;
    this.clearGroup(this.previewGroup);
    if (!this.preview) {
      this.updateDimensions();
      return;
    }
    const dx = end.xMm - start.xMm;
    const dz = end.zMm - start.zMm;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const thickness = this.room?.gridStepMm ?? 100;
    const geometry = new THREE.BoxGeometry(mmToWorld(length), 0.035, mmToWorld(thickness));
    const mesh = new THREE.Mesh(geometry, this.previewMaterial);
    const normalX = -dz / length;
    const normalZ = dx / length;
    mesh.position.set(
      mmToWorld((start.xMm + end.xMm) / 2 + normalX * (thickness / 2)),
      0.04,
      mmToWorld((start.zMm + end.zMm) / 2 + normalZ * (thickness / 2)),
    );
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.previewGroup.add(mesh);
    this.updateDimensions();
  }

  pick(event, includePoints = true) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const handleHit = this.raycaster.intersectObjects(this.handleGroup.children, true)[0];
    if (handleHit?.object?.userData?.type === "resize-handle") return handleHit.object.userData;
    const windowHit = this.raycaster.intersectObjects(this.windowGroup.children, true)[0];
    if (windowHit?.object?.userData?.type === "window") return windowHit.object.userData;
    const targets = includePoints ? [...this.pointGroup.children, ...this.wallGroup.children] : this.wallGroup.children;
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit?.object?.userData ?? null;
  }

  pickWall(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.wallGroup.children, false)[0];
    return hit?.object?.userData?.type === "wall" ? hit.object.userData : null;
  }

  pickWindow(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.windowGroup.children, true)[0];
    return hit?.object?.userData?.type === "window" ? hit.object.userData : null;
  }

  getWindowScreenAxis(item) {
    const transform = this.getWindowTransform(item);
    const yMm = item.sillHeightMm + item.heightMm / 2;
    const start = this.projectPoint(transform.start, yMm);
    const end = this.projectPoint(transform.end, yMm);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pixels = Math.max(1, Math.hypot(dx, dy));
    return { x: dx / pixels, y: dy / pixels, mmPerPixel: transform.length / pixels };
  }

  getWindowDragProjection(item) {
    const transform = this.getWindowTransform(item);
    const center = { xMm: transform.xMm, zMm: transform.zMm };
    const yMm = item.sillHeightMm + item.heightMm / 2;
    const origin = this.projectPoint(center, yMm);
    const alongWall = this.projectPoint({
      xMm: center.xMm + transform.axisX * 1000,
      zMm: center.zMm + transform.axisZ * 1000,
    }, yMm);
    const upward = this.projectPoint(center, yMm + 1000);
    return {
      horizontal: { x: (alongWall.x - origin.x) / 1000, y: (alongWall.y - origin.y) / 1000 },
      vertical: { x: (upward.x - origin.x) / 1000, y: (upward.y - origin.y) / 1000 },
    };
  }

  getWindowPointerAnchor(event, item) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.windowGroup.children, true)
      .find((candidate) => candidate.object?.userData?.id === item.id);
    if (!hit) return { alongMm: 0, verticalMm: 0 };
    const transform = this.getWindowTransform(item);
    const hitX = worldToMm(hit.point.x);
    const hitZ = worldToMm(hit.point.z);
    const hitOffset = (hitX - transform.start.xMm) * transform.axisX + (hitZ - transform.start.zMm) * transform.axisZ;
    return {
      alongMm: item.offsetMm - hitOffset,
      verticalMm: item.sillHeightMm + item.heightMm / 2 - worldToMm(hit.point.y),
    };
  }

  getWindowWallPlacement(event, item, anchor) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let best = null;
    this.room.walls.forEach((wall) => {
      const { start, end } = this.room.getWallPoints(wall);
      const dx = end.xMm - start.xMm;
      const dz = end.zMm - start.zMm;
      const length = Math.hypot(dx, dz);
      if (length < 1) return;
      const axisX = dx / length;
      const axisZ = dz / length;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(-axisZ, 0, axisX),
        new THREE.Vector3(mmToWorld(start.xMm), 0, mmToWorld(start.zMm)),
      );
      const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return;
      const hitOffset = (worldToMm(hit.x) - start.xMm) * axisX + (worldToMm(hit.z) - start.zMm) * axisZ;
      const hitHeight = worldToMm(hit.y);
      if (hitOffset < 0 || hitOffset > length || hitHeight < 0 || hitHeight > this.room.getWallHeight(wall)) return;
      const distance = hit.distanceTo(this.raycaster.ray.origin);
      if (best && best.distance <= distance) return;
      best = {
        distance,
        wallId: wall.id,
        offsetMm: hitOffset + anchor.alongMm,
        sillHeightMm: hitHeight + anchor.verticalMm - item.heightMm / 2,
      };
    });
    if (!best) return null;
    return { wallId: best.wallId, offsetMm: best.offsetMm, sillHeightMm: best.sillHeightMm };
  }

  getGroundPoint(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, target)) return null;
    return { xMm: Math.round(worldToMm(target.x)), zMm: Math.round(worldToMm(target.z)) };
  }

  getViewCenterMm() {
    const controls = this.viewMode === "top" ? this.topControls : this.perspectiveControls;
    return {
      xMm: Math.round(worldToMm(controls.target.x)),
      zMm: Math.round(worldToMm(controls.target.z)),
    };
  }

  updatePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  projectPoint(point, yMm = 0) {
    const vector = new THREE.Vector3(mmToWorld(point.xMm), mmToWorld(yMm), mmToWorld(point.zMm));
    vector.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (vector.x * 0.5 + 0.5) * rect.width, y: (-vector.y * 0.5 + 0.5) * rect.height, visible: vector.z > -1 && vector.z < 1 };
  }

  updateDimensions() {
    if (!this.room) return;
    this.dimensionLayer.replaceChildren();
    this.room.walls.forEach((wall) => {
      const { start, end } = this.room.getWallPoints(wall);
      const selected = wall.id === this.selectedWallId || this.selectedWallIds.has(wall.id);
      const heightMm = this.room.getWallHeight(wall);
      const thicknessMm = this.room.getWallThickness(wall);
      const dx = end.xMm - start.xMm;
      const dz = end.zMm - start.zMm;
      const length = Math.hypot(dx, dz);
      if (length > 0) {
        const facingSurface = getCameraFacingWallSurface(this.room, wall, {
          xMm: worldToMm(this.camera.position.x),
          zMm: worldToMm(this.camera.position.z),
        });
        const axisX = facingSurface.axis.x;
        const axisZ = facingSurface.axis.z;
        const normalX = facingSurface.normal.x;
        const normalZ = facingSurface.normal.z;
        const faceOffsetMm = this.viewMode === "3d" ? facingSurface.faceOffsetMm : thicknessMm / 2;
        const faceNudgeMm = this.viewMode === "3d" ? facingSurface.overlayOffsetMm : 2;
        const dimensionSpan = getWallDimensionSpan(this.room, wall, faceOffsetMm);
        const surfaceOffsetX = normalX * faceNudgeMm;
        const surfaceOffsetZ = normalZ * faceNudgeMm;
        this.addWallDimension(
          { xMm: dimensionSpan.start.xMm + surfaceOffsetX, zMm: dimensionSpan.start.zMm + surfaceOffsetZ, yMm: heightMm - 150 },
          { xMm: dimensionSpan.end.xMm + surfaceOffsetX, zMm: dimensionSpan.end.zMm + surfaceOffsetZ, yMm: heightMm - 150 },
          formatMm(dimensionSpan.lengthMm),
          "length",
          selected,
        );
        const heightEdgeOffset = Math.min(150, length * 0.08);
        const heightDistance = this.viewMode === "3d" && facingSurface.axisSide > 0
          ? length - heightEdgeOffset
          : heightEdgeOffset;
        const heightX = start.xMm + axisX * heightDistance + normalX * faceOffsetMm + surfaceOffsetX;
        const heightZ = start.zMm + axisZ * heightDistance + normalZ * faceOffsetMm + surfaceOffsetZ;
        this.addWallDimension(
          { xMm: heightX, zMm: heightZ, yMm: 0 },
          { xMm: heightX, zMm: heightZ, yMm: heightMm },
          formatMm(heightMm),
          "height",
          selected,
        );
      }
    });
    this.room.windows.forEach((item) => {
      const transform = this.getWindowTransform(item);
      if (this.viewMode === "3d" && !isWallPositiveFaceVisible(this.room, transform.wall, {
        xMm: worldToMm(this.camera.position.x),
        zMm: worldToMm(this.camera.position.z),
      })) return;
      const halfWidth = item.widthMm / 2;
      const selected = item.id === this.selectedWindowId || this.selectedWindowIds.has(item.id);
      this.addWallDimension(
        { xMm: transform.xMm - transform.axisX * halfWidth, zMm: transform.zMm - transform.axisZ * halfWidth, yMm: item.sillHeightMm + item.heightMm - 80 },
        { xMm: transform.xMm + transform.axisX * halfWidth, zMm: transform.zMm + transform.axisZ * halfWidth, yMm: item.sillHeightMm + item.heightMm - 80 },
        formatMm(item.widthMm), "window-width", selected,
      );
      const edgeX = transform.xMm - transform.axisX * (halfWidth - 90);
      const edgeZ = transform.zMm - transform.axisZ * (halfWidth - 90);
      this.addWallDimension(
        { xMm: edgeX, zMm: edgeZ, yMm: item.sillHeightMm },
        { xMm: edgeX, zMm: edgeZ, yMm: item.sillHeightMm + item.heightMm },
        formatMm(item.heightMm), "window-height", selected,
      );
      if (selected) {
        const wallHeight = this.room.getWallHeight(transform.wall);
        const leftMm = Math.max(0, item.offsetMm - halfWidth);
        const rightMm = Math.max(0, transform.length - item.offsetMm - halfWidth);
        const topMm = Math.max(0, wallHeight - item.sillHeightMm - item.heightMm);
        const surfaceStart = {
          xMm: transform.start.xMm + transform.normalX * this.room.getWallThickness(transform.wall),
          zMm: transform.start.zMm + transform.normalZ * this.room.getWallThickness(transform.wall),
        };
        const surfaceEnd = {
          xMm: transform.end.xMm + transform.normalX * this.room.getWallThickness(transform.wall),
          zMm: transform.end.zMm + transform.normalZ * this.room.getWallThickness(transform.wall),
        };
        const windowLeft = {
          xMm: transform.xMm - transform.axisX * halfWidth,
          zMm: transform.zMm - transform.axisZ * halfWidth,
        };
        const windowRight = {
          xMm: transform.xMm + transform.axisX * halfWidth,
          zMm: transform.zMm + transform.axisZ * halfWidth,
        };
        const horizontalY = item.sillHeightMm + item.heightMm / 2;
        this.addClearanceDimension({ ...surfaceStart, yMm: horizontalY }, { ...windowLeft, yMm: horizontalY }, formatMm(leftMm));
        this.addClearanceDimension({ ...windowRight, yMm: horizontalY }, { ...surfaceEnd, yMm: horizontalY }, formatMm(rightMm));
        if (item.kind !== "door") {
          this.addClearanceDimension(
            { xMm: transform.xMm, zMm: transform.zMm, yMm: 0 },
            { xMm: transform.xMm, zMm: transform.zMm, yMm: item.sillHeightMm },
            formatMm(item.sillHeightMm),
          );
        }
        this.addClearanceDimension(
          { xMm: transform.xMm, zMm: transform.zMm, yMm: item.sillHeightMm + item.heightMm },
          { xMm: transform.xMm, zMm: transform.zMm, yMm: wallHeight },
          formatMm(topMm),
        );
      }
    });
    if (this.preview) {
      const { start, end } = this.preview;
      const length = Math.hypot(end.xMm - start.xMm, end.zMm - start.zMm);
      this.addDimension(
        { xMm: (start.xMm + end.xMm) / 2, zMm: (start.zMm + end.zMm) / 2 },
        formatMm(length),
        { preview: true, yMm: 100 },
      );
    }
  }

  addDimension(point, text, { preview = false, className = "", yMm = 0 } = {}) {
    const screen = this.projectPoint(point, this.viewMode === "3d" ? yMm : 0);
    if (!screen.visible) return;
    const label = document.createElement("span");
    label.className = `dimension-label${preview ? " preview" : ""}${className ? ` ${className}` : ""}`;
    label.textContent = text;
    label.setAttribute("aria-hidden", "true");
    label.style.left = `${screen.x}px`;
    label.style.top = `${screen.y - 12}px`;
    this.dimensionLayer.append(label);
  }

  addWallDimension(start, end, text, kind, selected) {
    let startScreen = this.projectPoint(start, this.viewMode === "3d" ? start.yMm : 0);
    let endScreen = this.projectPoint(end, this.viewMode === "3d" ? end.yMm : 0);
    if (!startScreen.visible || !endScreen.visible) return;
    if (endScreen.x < startScreen.x) [startScreen, endScreen] = [endScreen, startScreen];
    const dx = endScreen.x - startScreen.x;
    const dy = endScreen.y - startScreen.y;
    const lengthPx = Math.hypot(dx, dy);
    if (lengthPx < 20) return;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const guide = document.createElement("span");
    guide.className = `wall-dimension-guide ${kind}${selected ? " selected" : ""}`;
    guide.setAttribute("aria-hidden", "true");
    guide.style.left = `${(startScreen.x + endScreen.x) / 2}px`;
    guide.style.top = `${(startScreen.y + endScreen.y) / 2}px`;
    guide.style.width = `${lengthPx}px`;
    guide.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
    const label = document.createElement("b");
    label.textContent = text;
    guide.append(label);
    this.dimensionLayer.append(guide);
  }

  addClearanceDimension(start, end, text) {
    const startScreen = this.projectPoint(start, this.viewMode === "3d" ? start.yMm : 0);
    const endScreen = this.projectPoint(end, this.viewMode === "3d" ? end.yMm : 0);
    if (!startScreen.visible || !endScreen.visible) return;
    const dx = endScreen.x - startScreen.x;
    const dy = endScreen.y - startScreen.y;
    const lengthPx = Math.hypot(dx, dy);
    if (lengthPx < 18) return;
    const guide = document.createElement("span");
    guide.className = "clearance-dimension";
    guide.style.left = `${(startScreen.x + endScreen.x) / 2}px`;
    guide.style.top = `${(startScreen.y + endScreen.y) / 2}px`;
    guide.style.width = `${lengthPx}px`;
    guide.style.transform = `translate(-50%, -50%) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
    const label = document.createElement("b");
    label.textContent = text;
    guide.append(label);
    this.dimensionLayer.append(guide);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = 12;
    this.topCamera.left = -(span * aspect) / 2;
    this.topCamera.right = (span * aspect) / 2;
    this.topCamera.top = span / 2;
    this.topCamera.bottom = -span / 2;
    this.topCamera.updateProjectionMatrix();
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateDimensions();
  }

  clearGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      child.traverse?.((item) => item.geometry?.dispose?.());
      if (child.material && ![this.wallMaterial, this.selectedWallMaterial, this.pointMaterial, this.firstPointMaterial, this.previewMaterial, this.floorMaterial].includes(child.material)) {
        child.material.dispose?.();
      }
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.topControls.update();
    this.perspectiveControls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateDimensions();
  }
}
