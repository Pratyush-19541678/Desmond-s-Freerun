"""Export Desmond from the .blend to game-ready desmond.glb.

Run headless (Blender 4.x):
  blender.exe --background "AC1-Desmond_Miles.blend" \
    --python "tools/export-desmond.py" -- "game/desmond.glb" "tools/desmond-stats.json"

What it does:
  1. Inspects the file (armatures, meshes, actions/animations, materials, textures).
  2. Selects every mesh + armature and exports a single GLB (+Y up, skinning kept).
  3. Writes a stats JSON with the world-space bounding box so the game can
     auto-scale Desmond to ~1.8 m tall with his feet on the ground.
"""
import bpy
import json
import os
import sys
from mathutils import Vector


def log(msg):
    print(f"[export-desmond] {msg}", flush=True)


def main():
    argv = sys.argv
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    if len(args) < 1:
        log("ERROR: pass output path: -- <out.glb> [stats.json]")
        sys.exit(2)
    out_glb = os.path.abspath(args[0])
    out_stats = os.path.abspath(args[1]) if len(args) > 1 else None

    log(f"Blender {bpy.app.version_string} | file: {bpy.data.filepath}")

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    actions = list(bpy.data.actions)
    log(f"objects={len(bpy.data.objects)} meshes={len(meshes)} "
        f"armatures={len(armatures)} actions={len(actions)} "
        f"materials={len(bpy.data.materials)} images={len(bpy.data.images)}")
    for a in armatures:
        log(f"  armature: {a.name}")
    for m in meshes[:20]:
        tris = len(m.data.loop_triangles) if hasattr(m.data, "loop_triangles") else "?"
        log(f"  mesh: {m.name} verts={len(m.data.vertices)} tris={tris}")
    for ac in actions:
        log(f"  action: {ac.name} frames=[{ac.frame_range[0]:.0f},{ac.frame_range[1]:.0f}]")
    for im in bpy.data.images:
        packed = "packed" if im.packed_file else f"external:{im.filepath}"
        log(f"  image: {im.name} {im.size[0]}x{im.size[1]} {packed}")

    if not meshes:
        log("ERROR: no mesh objects found, nothing to export")
        sys.exit(1)

    # Visibility approach (robust headless): hide everything we do NOT want
    # (cameras, lights, spare/duplicate parts) and export all visible objects.
    # Selection-based export is unreliable for the armature in background mode.
    hidden = []
    for o in bpy.data.objects:
        want = o.type in ("MESH", "ARMATURE", "EMPTY")
        if o.type == "MESH" and "clean" in o.name.lower():
            want = False  # spare overlapping head -> would z-fight in game
        try:
            o.hide_viewport = not want
            o.hide_render = not want
            o.hide_select = False
        except Exception:
            pass
        if not want:
            hidden.append(f"{o.name}({o.type})")
    bpy.context.view_layer.update()
    log(f"hidden from export: {hidden}")
    if armatures:
        bpy.context.view_layer.objects.active = armatures[0]
    elif meshes:
        bpy.context.view_layer.objects.active = meshes[0]

    # World-space bounding box (for game-side auto scaling).
    bpy.context.view_layer.update()
    ws_min = [1e18, 1e18, 1e18]
    ws_max = [-1e18, -1e18, -1e18]
    for o in meshes:
        for corner in o.bound_box:
            world = o.matrix_world @ Vector(corner)
            for i in range(3):
                ws_min[i] = min(ws_min[i], world[i])
                ws_max[i] = max(ws_max[i], world[i])
    size = [ws_max[i] - ws_min[i] for i in range(3)]
    log(f"bbox min={ws_min} max={ws_max} size={size} (Blender units, Z-up)")

    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    log(f"exporting GLB -> {out_glb}")
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format="GLB",
        use_selection=False,
        use_visible=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_nla_strips=True,
        export_skins=True,
        export_morph=True,
        export_materials="EXPORT",
    )
    if not os.path.exists(out_glb):
        log("ERROR: export produced no file")
        sys.exit(1)
    log(f"export OK, bytes={os.path.getsize(out_glb)}")

    stats = {
        "meshes": [m.name for m in meshes],
        "armatures": [a.name for a in armatures],
        "actions": [
            {"name": ac.name,
             "frame_start": ac.frame_range[0],
             "frame_end": ac.frame_range[1]} for ac in actions
        ],
        "materials": [m.name for m in bpy.data.materials if m.users],
        "bbox_min": ws_min,   # Blender space (x, y, z-up)
        "bbox_max": ws_max,
        "bbox_size": size,
        "glb": out_glb,
        "glb_bytes": os.path.getsize(out_glb),
    }
    if out_stats:
        os.makedirs(os.path.dirname(out_stats), exist_ok=True)
        with open(out_stats, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)
        log(f"stats written -> {out_stats}")
    print("EXPORT_STATS::" + json.dumps(stats), flush=True)


main()
