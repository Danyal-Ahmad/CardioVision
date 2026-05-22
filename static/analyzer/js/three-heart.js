/* ================================================================
   CardioVision v6 — Three.js 3D Heart (Clean)
   ================================================================ */
(function () {
    'use strict';

    const container = document.getElementById('heart3dContainer');
    if (!container || typeof THREE === 'undefined') return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(420, 420);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Heart shape
    const heartShape = new THREE.Shape();
    const s = 0.08;
    heartShape.moveTo(s * 25, s * 25);
    heartShape.bezierCurveTo(s * 25, s * 25, s * 20, 0, 0, 0);
    heartShape.bezierCurveTo(-s * 30, 0, -s * 30, s * 35, -s * 30, s * 35);
    heartShape.bezierCurveTo(-s * 30, s * 55, -s * 10, s * 77, s * 25, s * 95);
    heartShape.bezierCurveTo(s * 60, s * 77, s * 80, s * 55, s * 80, s * 35);
    heartShape.bezierCurveTo(s * 80, s * 35, s * 80, 0, s * 50, 0);
    heartShape.bezierCurveTo(s * 35, 0, s * 25, s * 25, s * 25, s * 25);

    const geometry = new THREE.ExtrudeGeometry(heartShape, {
        depth: 1.2,
        bevelEnabled: true,
        bevelSegments: 8,
        steps: 2,
        bevelSize: 0.35,
        bevelThickness: 0.35,
    });
    geometry.center();

    // Main heart
    const material = new THREE.MeshPhongMaterial({
        color: 0xe63970,
        specular: 0xffb3d9,
        shininess: 100,
        transparent: true,
        opacity: 0.85,
    });
    const heartMesh = new THREE.Mesh(geometry, material);
    scene.add(heartMesh);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(3, 4, 5);
    scene.add(dirLight);

    const pointLight1 = new THREE.PointLight(0xe63970, 0.5, 10);
    pointLight1.position.set(-3, 2, 3);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x7c3aed, 0.3, 10);
    pointLight2.position.set(3, -2, 2);
    scene.add(pointLight2);

    // Animate
    let time = 0;
    function animate() {
        requestAnimationFrame(animate);
        time += 0.008;

        // Gentle rotation
        heartMesh.rotation.y = Math.sin(time * 0.4) * 0.3;
        heartMesh.rotation.x = Math.sin(time * 0.25) * 0.1;

        // Realistic heartbeat: lub-dub pattern
        const beatCycle = time * 2.5;
        const lub = Math.max(0, Math.sin(beatCycle) * 0.6);
        const dub = Math.max(0, Math.sin(beatCycle + 0.8) * 0.35);
        const beat = 1 + lub * 0.06 + dub * 0.03;
        heartMesh.scale.set(beat, beat, beat);

        renderer.render(scene, camera);
    }
    animate();
})();
