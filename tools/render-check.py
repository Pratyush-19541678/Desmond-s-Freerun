"""Render turntable + action stills of Desmond for visual verification.

Usage:
  blender.exe --background "AC1-Desmond_Miles.blend" \
    --python "tools/render-check.py" -- "tools/preview"

Builds all parkour actions (imports animate-desmond builders), mutes NLA,
then renders bind pose from 4 sides + one still per action. Open the PNGs
to check facing direction and that every clip actually poses the body.
"""
import bpy
import math
import os
import sys


def log(m):
    print(f"[render-check] {m}", flush=True)


argv = sys.argv
outdir = os.path.abspath(argv[argv.index("--") + 1])
os.makedirs(outdir, exist_ok=True)

# Build all actions (executes animate-desmond main: prep + 8 actions + NLA).
TOOLS = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location(
    "desmond_anim", os.path.join(TOOLS, "animate-desmond.py"))
desmond_anim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desmond_anim)

arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
log(f"armature={arm.name if arm else None}")
# mute NLA so direct action assignment drives the pose
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

# aim + camera + sun
aim = bpy.data.objects.new("Aim", None)
sc.collection.objects.link(aim)
aim.location = (0, 0, -0.05)
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
fill_data = bpy.data.lights.new("CheckFill", "SUN")
fill_data.energy = 0.8
fill_obj = bpy.data.objects.new("CheckFill", fill_data)
sc.collection.objects.link(fill_obj)
fill_obj.location = (-3, 2, 1)


def shot(name, angle_deg, action_name, frame, dist=3.4, height=0.35):
    a = math.radians(angle_deg)
    cam_obj.location = (dist * math.cos(a), dist * math.sin(a), height)
    if action_name:
        arm.animation_data.action = bpy.data.actions.get(action_name)
    else:
        arm.animation_data.action = None
    sc.frame_set(frame)
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(outdir, name)
    bpy.ops.render.render(write_still=True)
    log(f"rendered {name}.png action={action_name} frame={frame} angle={angle_deg}")


# bind pose turntable (which way does the face point?)
for ang in (0, 90, 180, 270):
    shot(f"bind_{ang:03d}", ang, None, 1)

# action stills (side profile shows limbs best)
shots = [
    ("run_a", 90, "Desmond_Run", 6), ("run_b", 90, "Desmond_Run", 18),
    ("walk_a", 90, "Desmond_Walk", 6), ("walk_b", 90, "Desmond_Walk", 18),
    ("hang", 90, "Desmond_Hang", 8), ("hold", 90, "Desmond_Hold", 6),
    ("climb_a", 90, "Desmond_Climb", 6), ("climb_b", 90, "Desmond_Climb", 18),
    ("dive", 90, "Desmond_Dive", 6), ("idle", 90, "Desmond_Idle", 36),
    ("crouch", 90, "Desmond_Crouch", 6), ("prone", 90, "Desmond_Prone", 8),
    ("dodge", 90, "Desmond_Dodge", 5),
]
for name, ang, act, frm in shots:
    shot(name, ang, act, frm)

log("DONE " + outdir)
