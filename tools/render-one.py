"""Render ONE action still (fast pose iteration).

Usage:
  blender.exe --background "AC1-Desmond_Miles.blend" \
    --python "tools/render-one.py" -- out.png ActionName frame angle
"""
import bpy
import math
import os
import sys


def log(m):
    print(f"[render-one] {m}", flush=True)


argv = sys.argv
args = argv[argv.index("--") + 1:]
out, action_name, frame, angle = args[0], args[1], int(args[2]), float(args[3])

TOOLS = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location(
    "desmond_anim", os.path.join(TOOLS, "animate-desmond.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm and arm.animation_data:
    for t in arm.animation_data.nla_tracks:
        t.mute = True

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 64
sc.render.resolution_x = 420
sc.render.resolution_y = 420
w = sc.world
w.use_nodes = True
bg = w.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.72, 0.76, 0.82, 1.0)
    bg.inputs[1].default_value = 1.2

aim = bpy.data.objects.new("Aim", None)
sc.collection.objects.link(aim)
aim.location = (0, 0, -0.35)
cam_data = bpy.data.cameras.new("CheckCam")
cam_obj = bpy.data.objects.new("CheckCam", cam_data)
sc.collection.objects.link(cam_obj)
sc.camera = cam_obj
cam_data.lens = 50
trk = cam_obj.constraints.new("TRACK_TO")
trk.target = aim
trk.track_axis = "TRACK_NEGATIVE_Z"
trk.up_axis = "UP_Y"
sun_data = bpy.data.lights.new("CheckSun", "SUN")
sun_data.energy = 3.0
sun_obj = bpy.data.objects.new("CheckSun", sun_data)
sc.collection.objects.link(sun_obj)
sun_obj.location = (2, -3, 4)

a = math.radians(angle)
cam_obj.location = (3.4 * math.cos(a), 3.4 * math.sin(a), 0.1)
arm.animation_data.action = bpy.data.actions.get(action_name)
sc.frame_set(frame)
bpy.context.view_layer.update()
sc.render.filepath = os.path.abspath(out)
bpy.ops.render.render(write_still=True)
log(f"DONE {out}")
