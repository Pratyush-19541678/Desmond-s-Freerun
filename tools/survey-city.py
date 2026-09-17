"""Measure Monteriggioni scale + street-level proportion renders.

Usage:
  blender.exe --background --python "tools/survey-city.py" -- outdir

Imports scene.gltf, prints world bbox + height histogram, places a 1.8 m
human reference box, and renders two eye-level street views so door and
window sizes can be judged against a human.
"""
import bpy
import os
import sys
from mathutils import Vector


def log(m):
    print(f"[survey-city] {m}", flush=True)


argv = sys.argv
outdir = os.path.abspath(argv[argv.index("--") + 1])
os.makedirs(outdir, exist_ok=True)
HERE = r"C:\Users\PRATUYSH\Downloads\Desmon Run"

bpy.ops.import_scene.gltf(
    filepath=os.path.join(HERE, "scene.gltf"))
log("imported scene.gltf")

mn = Vector((1e18, 1e18, 1e18))
mx = Vector((-1e18, -1e18, -1e18))
nverts = 0
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn.x = min(mn.x, w.x); mn.y = min(mn.y, w.y); mn.z = min(mn.z, w.z)
        mx.x = max(mx.x, w.x); mx.y = max(mx.y, w.y); mx.z = max(mx.z, w.z)
    nverts += len(o.data.vertices)
size = mx - mn
log(f"meshes={len(meshes)} verts={nverts}")
log(f"bbox min={[round(v, 1) for v in mn]} max={[round(v, 1) for v in mx]}")
log(f"size x={size.x:.1f} y={size.y:.1f} z(up)={size.z:.1f} diag={size.length:.1f}")

# height histogram (world Z) to see ground/street/roof bands
import numpy as np
try:
    zs = []
    for o in meshes:
        vs = o.data.vertices
        step = max(1, len(vs) // 20000)
        M = o.matrix_world
        for i in range(0, len(vs), step):
            zs.append((M @ vs[i].co).z)
    zs = np.array(zs)
    for q in (0, 5, 25, 50, 75, 95, 100):
        log(f"  height p{q}={np.percentile(zs, q):.1f}")
except Exception as e:
    log(f"histogram skipped: {e}")

# 1.8 m human reference box ON the street deck (p5 height band)
cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
gz = 265.2
bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, gz + 0.9))
ref = bpy.context.active_object
ref.name = "HumanRef_1m8"
ref.scale = (0.5, 0.3, 1.8)
bpy.ops.object.transform_apply(scale=True)
mat = bpy.data.materials.new("RefRed")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.9, 0.05, 0.05, 1)
ref.data.materials.append(mat)
log(f"human ref at {[round(v, 1) for v in ref.location]}")

# street renders: eye-level camera looking at the reference human
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.render.resolution_x = 640
sc.render.resolution_y = 400
sc.display.shading.light = "STUDIO"
aim = bpy.data.objects.new("Aim", None)
sc.collection.objects.link(aim)
cam_data = bpy.data.cameras.new("StreetCam")
cam_obj = bpy.data.objects.new("StreetCam", cam_data)
sc.collection.objects.link(cam_obj)
sc.camera = cam_obj
cam_data.lens = 35
trk = cam_obj.constraints.new("TRACK_TO")
trk.target = aim
trk.track_axis = "TRACK_NEGATIVE_Z"
trk.up_axis = "UP_Y"

views = [
    ("street_a", (cx + 14, cy - 16, gz + 1.7), (cx, cy, gz + 2.0)),
    ("street_b", (cx - 18, cy + 10, gz + 1.7), (cx, cy, gz + 3.0)),
]
for name, campos, aimpos in views:
    cam_obj.location = campos
    aim.location = aimpos
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(outdir, name)
    bpy.ops.render.render(write_still=True)
    log(f"rendered {name}.png")

log("DONE")
