"""Author in-place Run / Idle / Jump actions on the Desmond rig.

Usage (in-memory, does NOT save the .blend):
  blender.exe --background "AC1-Desmond_Miles.blend" \
    --python "tools/animate-desmond.py" \
    --python "tools/export-desmond.py" -- "game/desmond.glb" "tools/desmond-stats.json"

The rig is a Mixamo-style FK chain facing +X (toes +X, up +Z, right side -Y).
Because bone rolls vary, the script auto-detects each bone's local pitch axis
(the euler component whose world direction best matches sideways ±Y) and keys
only that component, so swings always move limbs forward/backward.
"""
import bpy
import math
import sys
from mathutils import Vector


def log(m):
    print(f"[animate] {m}", flush=True)


PITCH_WORLD = Vector((0.0, 1.0, 0.0))  # swing matcher (proven on every cycle)


def pitch_axis(arm, bone_name):
    """Return (euler_index, sign) for the main swing of a pose bone."""
    b = arm.data.bones[bone_name]
    m = b.matrix_local  # rest matrix, armature space
    best, best_idx, best_sign = 0.0, 1, 1.0
    for idx in (0, 2):  # local X or Z (local Y runs along the bone)
        axis = Vector((m[0][idx], m[1][idx], m[2][idx])).normalized()
        d = axis.dot(PITCH_WORLD)
        if abs(d) > abs(best):
            best, best_idx, best_sign = d, idx, 1.0 if d > 0 else -1.0
    return best_idx, best_sign


def key(pb, frame, pitch=None, loc=None, roll=None, outward=None):
    if pitch is not None or roll is not None:
        e = list(pb.rotation_euler)
        if pitch is not None:
            e[pb["pitch_idx"]] = pb["pitch_sign"] * pitch
        if roll is not None:
            # rotate about the other horizontal axis; sign chosen so the limb
            # tip initially moves toward `outward` (for mirrored arm spreads)
            col = Vector(pb["roll_col"])
            d = Vector(pb["bone_dir"])
            v = col.cross(d)
            o = outward if outward is not None else Vector((0, 0, 1))
            s = 1.0 if v.dot(o) >= 0 else -1.0
            e[pb["roll_idx"]] = s * roll
        pb.rotation_euler = e
        pb.keyframe_insert(data_path="rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert(data_path="location", frame=frame)


def prep(arm, names):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for n in names:
        pb = arm.pose.bones[n]
        pb.rotation_mode = "XYZ"
        idx, sign = pitch_axis(arm, n)
        pb["pitch_idx"] = idx
        pb["pitch_sign"] = sign
        ridx = 0 if idx == 2 else 2
        b = arm.data.bones[n]
        col = Vector((b.matrix_local[0][ridx], b.matrix_local[1][ridx],
                      b.matrix_local[2][ridx])).normalized()
        bdir = (Vector(b.tail_local) - Vector(b.head_local)).normalized()
        pb["roll_idx"] = ridx
        pb["roll_col"] = tuple(col)
        pb["bone_dir"] = tuple(bdir)
    bpy.ops.object.mode_set(mode="OBJECT")


def new_action(arm, name, f_start, f_end):
    act = bpy.data.actions.new(name)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    sc = bpy.context.scene
    sc.frame_start = min(sc.frame_start, f_start)
    sc.frame_end = max(sc.frame_end, f_end)
    sc.render.fps = 30
    return act


def stash_to_nla(arm, act, start):
    ad = arm.animation_data
    track = ad.nla_tracks.new()
    track.name = act.name
    strip = track.strips.new(act.name, int(start), act)
    strip.extrapolation = "HOLD"
    return track


def build_run(arm, B):
    FPS = 30
    N = 24  # one looped stride
    act = new_action(arm, "Desmond_Run", 1, N)
    A_leg, A_arm, K = 0.75, 0.6, 1.0
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        s, c = math.sin(th), math.cos(th)
        # legs (left leads with +phase)
        key(B["RightUpLeg"], f, pitch=-A_leg * s)
        key(B["LeftUpLeg"], f, pitch=A_leg * s)
        key(B["RightLeg"], f, pitch=0.25 + K * (0.5 + 0.5 * math.sin(th + 1.1)))
        key(B["LeftLeg"], f, pitch=0.25 + K * (0.5 + 0.5 * math.sin(th + math.pi + 1.1)))
        key(B["RightFoot"], f, pitch=0.35 * s - 0.15)
        key(B["LeftFoot"], f, pitch=-0.35 * s - 0.15)
        # arms oppose same-side leg
        key(B["RightArm"], f, pitch=A_arm * s)
        key(B["LeftArm"], f, pitch=-A_arm * s)
        key(B["RFore"], f, pitch=-(0.55 + 0.3 * (0.5 + 0.5 * s)))
        key(B["LFore"], f, pitch=-(0.55 + 0.3 * (0.5 - 0.5 * s)))
        # torso lean + bob, hips bob twice per stride
        key(B["Spine"], f, pitch=0.10 + 0.03 * math.cos(2 * th))
        key(B["Spine1"], f, pitch=0.06 + 0.02 * math.cos(2 * th))
        key(B["Spine2"], f, pitch=0.04)
        key(B["Neck"], f, pitch=-0.10)
        key(B["Hips"], f, loc=(0, 0.015 * s, -0.03 + 0.03 * math.cos(2 * th)))
    # sine is sampled over a full period so the loop is already seamless
    for fc in act.fcurves:
        if len(fc.keyframe_points) >= 2:
            first = fc.keyframe_points[0]
            last = fc.keyframe_points[-1]
            if abs(first.co.x - 1.0) < 0.01 and abs(last.co.x - N) < 0.01:
                # already periodic (sine sampled over full period) - nothing to do
                pass
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Run: {len(act.fcurves)} fcurves")
    return act


def build_idle(arm, B):
    N = 72
    act = new_action(arm, "Desmond_Idle", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        br = math.sin(th)  # breath
        key(B["RightUpLeg"], f, pitch=0.02 * br)
        key(B["LeftUpLeg"], f, pitch=-0.02 * br)
        key(B["RightLeg"], f, pitch=0.06)
        key(B["LeftLeg"], f, pitch=0.06)
        key(B["RightArm"], f, pitch=0.05 * br)
        key(B["LeftArm"], f, pitch=-0.05 * br)
        key(B["RFore"], f, pitch=-0.12)
        key(B["LFore"], f, pitch=-0.12)
        key(B["Spine"], f, pitch=0.02 + 0.015 * br)
        key(B["Spine1"], f, pitch=0.01 + 0.01 * br)
        key(B["Spine2"], f, pitch=0.01)
        key(B["Neck"], f, pitch=-0.03 + 0.02 * math.sin(th + 0.7))
        key(B["RightFoot"], f, pitch=0.0)
        key(B["LeftFoot"], f, pitch=0.0)
        key(B["Hips"], f, loc=(0, 0, 0.008 * br))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Idle: {len(act.fcurves)} fcurves")
    return act


def build_rise(arm, B):
    # takeoff extension (plays while rising): crouch uncoils to full
    # extension, arms sweep up — holds as a loop with a micro bounce
    N = 12
    act = new_action(arm, "Desmond_Rise", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        bob = math.sin(th) * 0.05
        key(B["RightUpLeg"], f, pitch=-0.12 + bob)
        key(B["LeftUpLeg"], f, pitch=-0.1 - bob)
        key(B["RightLeg"], f, pitch=0.1)
        key(B["LeftLeg"], f, pitch=0.1)
        key(B["RightFoot"], f, pitch=0.3)
        key(B["LeftFoot"], f, pitch=0.3)
        key(B["RightArm"], f, pitch=-1.2 + 0.025 * bob)
        key(B["LeftArm"], f, pitch=-1.1 - 0.025 * bob)
        key(B["RFore"], f, pitch=-0.2)
        key(B["LFore"], f, pitch=-0.2)
        key(B["Spine"], f, pitch=-0.02)
        key(B["Spine1"], f, pitch=0.0)
        key(B["Spine2"], f, pitch=0.0)
        key(B["Neck"], f, pitch=-0.12)
        key(B["Hips"], f, loc=(0, 0, 0.03 + 0.01 * bob))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Rise: {len(act.fcurves)} fcurves")
    return act


def build_fall(arm, B):
    # airborne fall (plays while dropping): knees gathered, arms slightly
    # out and back for balance, eyes on the landing — loops seamlessly
    N = 16
    act = new_action(arm, "Desmond_Fall", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        sw = math.sin(th) * 0.05
        key(B["RightUpLeg"], f, pitch=-0.55 + sw)
        key(B["LeftUpLeg"], f, pitch=-0.5 - sw)
        key(B["RightLeg"], f, pitch=1.1)
        key(B["LeftLeg"], f, pitch=1.0)
        key(B["RightFoot"], f, pitch=-0.3)
        key(B["LeftFoot"], f, pitch=-0.3)
        key(B["RightArm"], f, pitch=0.35 + sw)
        key(B["LeftArm"], f, pitch=0.4 - sw)
        key(B["RFore"], f, pitch=-0.5)
        key(B["LFore"], f, pitch=-0.5)
        key(B["Spine"], f, pitch=0.12)
        key(B["Spine1"], f, pitch=0.06)
        key(B["Spine2"], f, pitch=0.03)
        key(B["Neck"], f, pitch=-0.05)
        key(B["Hips"], f, loc=(0, 0, 0.0))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Fall: {len(act.fcurves)} fcurves")
    return act


def build_jump(arm, B):
    # crouch -> extend -> tuck -> land-prep (24f, loops acceptably)
    N = 24
    act = new_action(arm, "Desmond_Jump", 1, N)
    poses = {
        1: dict(hips=-0.12, thigh=0.35, knee=1.15, arm=0.3, elb=-0.5, spine=0.28),
        7: dict(hips=0.05, thigh=-0.1, knee=0.08, arm=-1.1, elb=-0.3, spine=0.05),
        13: dict(hips=0.02, thigh=-0.95, knee=1.75, arm=-2.2, elb=-0.4, spine=-0.05),
        19: dict(hips=-0.02, thigh=-0.25, knee=0.55, arm=-0.9, elb=-0.5, spine=0.12),
        24: dict(hips=-0.12, thigh=0.35, knee=1.15, arm=0.3, elb=-0.5, spine=0.28),
    }
    for f, p in poses.items():
        key(B["RightUpLeg"], f, pitch=p["thigh"])
        key(B["LeftUpLeg"], f, pitch=p["thigh"] * 0.9)
        key(B["RightLeg"], f, pitch=p["knee"])
        key(B["LeftLeg"], f, pitch=p["knee"] * 0.95)
        key(B["RightFoot"], f, pitch=-0.5)
        key(B["LeftFoot"], f, pitch=-0.5)
        key(B["RightArm"], f, pitch=p["arm"])
        key(B["LeftArm"], f, pitch=p["arm"] * 0.9)
        key(B["RFore"], f, pitch=p["elb"])
        key(B["LFore"], f, pitch=p["elb"])
        key(B["Spine"], f, pitch=p["spine"])
        key(B["Spine1"], f, pitch=p["spine"] * 0.6)
        key(B["Spine2"], f, pitch=0.0)
        key(B["Neck"], f, pitch=-0.1)
        key(B["Hips"], f, loc=(0, 0, p["hips"]))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Jump: {len(act.fcurves)} fcurves")
    return act


def build_walk(arm, B):
    # relaxed in-place walk cycle (24f loop), smaller than the run
    N = 24
    act = new_action(arm, "Desmond_Walk", 1, N)
    A_leg, A_arm = 0.5, 0.38
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        s = math.sin(th)
        key(B["RightUpLeg"], f, pitch=-A_leg * s)
        key(B["LeftUpLeg"], f, pitch=A_leg * s)
        key(B["RightLeg"], f, pitch=0.12 + 0.55 * (0.5 + 0.5 * math.sin(th + 1.1)))
        key(B["LeftLeg"], f, pitch=0.12 + 0.55 * (0.5 + 0.5 * math.sin(th + math.pi + 1.1)))
        key(B["RightFoot"], f, pitch=0.18 * s - 0.08)
        key(B["LeftFoot"], f, pitch=-0.18 * s - 0.08)
        key(B["RightArm"], f, pitch=A_arm * s)
        key(B["LeftArm"], f, pitch=-A_arm * s)
        key(B["RFore"], f, pitch=-(0.35 + 0.12 * (0.5 + 0.5 * s)))
        key(B["LFore"], f, pitch=-(0.35 + 0.12 * (0.5 - 0.5 * s)))
        key(B["Spine"], f, pitch=0.06 + 0.02 * math.cos(2 * th))
        key(B["Spine1"], f, pitch=0.03)
        key(B["Spine2"], f, pitch=0.02)
        key(B["Neck"], f, pitch=-0.05)
        key(B["Hips"], f, loc=(0, 0.012 * s, -0.015 + 0.025 * math.cos(2 * th)))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Walk: {len(act.fcurves)} fcurves")
    return act


def build_hang(arm, B):
    # dead-hang from a ledge: arms overhead, body straight, toes pointed
    N = 16
    act = new_action(arm, "Desmond_Hang", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        sw = math.sin(th)
        key(B["RightArm"], f, pitch=-2.35 + 0.03 * sw)
        key(B["LeftArm"], f, pitch=-2.35 - 0.03 * sw)
        key(B["RFore"], f, pitch=-0.15)
        key(B["LFore"], f, pitch=-0.15)
        key(B["RightUpLeg"], f, pitch=0.08)
        key(B["LeftUpLeg"], f, pitch=0.08)
        key(B["RightLeg"], f, pitch=0.4)
        key(B["LeftLeg"], f, pitch=0.4)
        key(B["RightFoot"], f, pitch=0.55)
        key(B["LeftFoot"], f, pitch=0.55)
        key(B["Spine"], f, pitch=0.06)
        key(B["Spine1"], f, pitch=0.03)
        key(B["Spine2"], f, pitch=0.02)
        key(B["Neck"], f, pitch=-0.12)
        key(B["Hips"], f, loc=(0, 0.01 * sw, -0.03))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Hang: {len(act.fcurves)} fcurves")
    return act


def build_climb(arm, B):
    # in-place vertical climb cycle (24f loop): sides alternate reach + knee drive
    N = 24
    act = new_action(arm, "Desmond_Climb", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        ls = math.sin(th)
        rs = math.sin(th + math.pi)
        key(B["RightArm"], f, pitch=-1.95 - 0.4 * rs)
        key(B["LeftArm"], f, pitch=-1.95 - 0.4 * ls)
        key(B["RFore"], f, pitch=-(0.75 + 0.15 * rs))
        key(B["LFore"], f, pitch=-(0.75 + 0.15 * ls))
        key(B["RightUpLeg"], f, pitch=-0.45 - 0.6 * rs)
        key(B["LeftUpLeg"], f, pitch=-0.45 - 0.6 * ls)
        key(B["RightLeg"], f, pitch=1.0 + 0.7 * rs)
        key(B["LeftLeg"], f, pitch=1.0 + 0.7 * ls)
        key(B["RightFoot"], f, pitch=0.2)
        key(B["LeftFoot"], f, pitch=0.2)
        key(B["Spine"], f, pitch=0.14 + 0.03 * math.cos(2 * th))
        key(B["Spine1"], f, pitch=0.07)
        key(B["Spine2"], f, pitch=0.04)
        key(B["Neck"], f, pitch=-0.12)
        key(B["Hips"], f, loc=(0, 0, -0.02 + 0.04 * math.cos(2 * th)))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Climb: {len(act.fcurves)} fcurves")
    return act


def build_hold(arm, B):
    # static cling: plastered to the face, right hand high on a hold,
    # left hand mid, right knee up on a creak, left leg braced below
    N = 12
    act = new_action(arm, "Desmond_Hold", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        br = math.sin(th)  # faint breathing against the stone
        key(B["RightArm"], f, pitch=-2.15 + 0.02 * br)
        key(B["LeftArm"], f, pitch=-1.2 + 0.02 * br)
        key(B["RFore"], f, pitch=-0.45)
        key(B["LFore"], f, pitch=-0.85)
        key(B["RightUpLeg"], f, pitch=-0.9)
        key(B["LeftUpLeg"], f, pitch=0.2)
        key(B["RightLeg"], f, pitch=1.6)
        key(B["LeftLeg"], f, pitch=0.15)
        key(B["RightFoot"], f, pitch=0.3)
        key(B["LeftFoot"], f, pitch=0.1)
        key(B["Spine"], f, pitch=0.1 + 0.01 * br)
        key(B["Spine1"], f, pitch=0.05)
        key(B["Spine2"], f, pitch=0.03)
        key(B["Neck"], f, pitch=-0.08)
        key(B["Hips"], f, loc=(0, 0, 0.005 * br))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Hold: {len(act.fcurves)} fcurves")
    return act

def build_dive(arm, B):
    # leap-of-faith: both arms thrown overhead-forward, body straight,
    # toes pointed (symmetric by construction — verified on renders)
    N = 12
    act = new_action(arm, "Desmond_Dive", 1, N)
    for f in range(1, N + 1):
        key(B["RightArm"], f, pitch=-1.85)
        key(B["LeftArm"], f, pitch=-1.75)
        key(B["RFore"], f, pitch=-0.15)
        key(B["LFore"], f, pitch=-0.15)
        key(B["RightUpLeg"], f, pitch=0.25)
        key(B["LeftUpLeg"], f, pitch=0.25)
        key(B["RightLeg"], f, pitch=0.12)
        key(B["LeftLeg"], f, pitch=0.12)
        key(B["RightFoot"], f, pitch=0.7)
        key(B["LeftFoot"], f, pitch=0.7)
        key(B["Spine"], f, pitch=-0.12)
        key(B["Spine1"], f, pitch=-0.06)
        key(B["Spine2"], f, pitch=-0.03)
        key(B["Neck"], f, pitch=-0.2)
        key(B["Hips"], f, loc=(0, 0, 0.02))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Dive: {len(act.fcurves)} fcurves")
    return act


def build_crouch(arm, B):
    # deep sneak-crouch: knees folded, torso forward, hands reaching low
    N = 12
    act = new_action(arm, "Desmond_Crouch", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        br = math.sin(th)
        key(B["RightUpLeg"], f, pitch=-1.3 + 0.03 * br)
        key(B["LeftUpLeg"], f, pitch=-1.25 - 0.03 * br)
        key(B["RightLeg"], f, pitch=2.0)
        key(B["LeftLeg"], f, pitch=1.95)
        key(B["RightFoot"], f, pitch=0.2)
        key(B["LeftFoot"], f, pitch=0.2)
        key(B["RightArm"], f, pitch=-0.7 + 0.03 * br)
        key(B["LeftArm"], f, pitch=-0.65 - 0.03 * br)
        key(B["RFore"], f, pitch=-0.6)
        key(B["LFore"], f, pitch=-0.6)
        key(B["Spine"], f, pitch=0.5 + 0.02 * br)
        key(B["Spine1"], f, pitch=0.3)
        key(B["Spine2"], f, pitch=0.15)
        key(B["Neck"], f, pitch=-0.35)
        key(B["Hips"], f, loc=(0, 0, -0.45))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Crouch: {len(act.fcurves)} fcurves")
    return act


def build_prone(arm, B):
    # tunnel crawl: weight on knees + hands, torso near-horizontal, head up.
    # (Hips dropped to the deck, thighs folded fully under, shins trailed
    # back flat, arms reaching ahead — reads unambiguously as prone.)
    N = 16
    act = new_action(arm, "Desmond_Prone", 1, N)
    for f in range(1, N + 1):
        th = (f - 1) / N * 2 * math.pi
        rock = math.sin(th)
        key(B["RightUpLeg"], f, pitch=-2.2 + 0.06 * rock)
        key(B["LeftUpLeg"], f, pitch=-2.1 - 0.06 * rock)
        key(B["RightLeg"], f, pitch=2.5)
        key(B["LeftLeg"], f, pitch=2.4)
        key(B["RightFoot"], f, pitch=1.2)
        key(B["LeftFoot"], f, pitch=1.2)
        key(B["RightArm"], f, pitch=-1.7 + 0.06 * rock)
        key(B["LeftArm"], f, pitch=-1.6 - 0.06 * rock)
        key(B["RFore"], f, pitch=-0.3)
        key(B["LFore"], f, pitch=-0.3)
        key(B["Spine"], f, pitch=1.1)
        key(B["Spine1"], f, pitch=0.6)
        key(B["Spine2"], f, pitch=0.3)
        key(B["Neck"], f, pitch=-0.7)
        key(B["Hips"], f, loc=(0, 0.02 * rock, -0.72))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Prone: {len(act.fcurves)} fcurves")
    return act


def build_slide(arm, B):
    # feet-first powerslide (DPS VaultSlide): front leg extended, back leg
    # tucked under, torso leaned back, one hand trailing — low 0.6 m profile
    N = 12
    act = new_action(arm, "Desmond_Slide", 1, N)
    for f in range(1, N + 1):
        key(B["RightUpLeg"], f, pitch=-1.4)
        key(B["LeftUpLeg"], f, pitch=-0.5)
        key(B["RightLeg"], f, pitch=0.15)
        key(B["LeftLeg"], f, pitch=2.2)
        key(B["RightFoot"], f, pitch=0.5)
        key(B["LeftFoot"], f, pitch=0.6)
        key(B["RightArm"], f, pitch=0.7)
        key(B["LeftArm"], f, pitch=-0.5)
        key(B["RFore"], f, pitch=-0.3)
        key(B["LFore"], f, pitch=-0.5)
        key(B["Spine"], f, pitch=-0.35)
        key(B["Spine1"], f, pitch=-0.2)
        key(B["Spine2"], f, pitch=-0.1)
        key(B["Neck"], f, pitch=-0.25)
        key(B["Hips"], f, loc=(0, 0, -0.6))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Slide: {len(act.fcurves)} fcurves")
    return act


def build_dodge(arm, B):    # explosive feint lunge: deep forward split, torso over it, arms pumping.
    # (Directional read comes from the holder lean; the pose itself is symmetric.)
    N = 10
    act = new_action(arm, "Desmond_Dodge", 1, N)
    for f in range(1, N + 1):
        key(B["RightUpLeg"], f, pitch=-1.3)
        key(B["LeftUpLeg"], f, pitch=0.6)
        key(B["RightLeg"], f, pitch=1.9)
        key(B["LeftLeg"], f, pitch=0.2)
        key(B["RightFoot"], f, pitch=0.3)
        key(B["LeftFoot"], f, pitch=-0.2)
        key(B["RightArm"], f, pitch=-1.4)
        key(B["LeftArm"], f, pitch=0.5)
        key(B["RFore"], f, pitch=-0.9)
        key(B["LFore"], f, pitch=-0.4)
        key(B["Spine"], f, pitch=0.45)
        key(B["Spine1"], f, pitch=0.25)
        key(B["Spine2"], f, pitch=0.1)
        key(B["Neck"], f, pitch=-0.1)
        key(B["Hips"], f, loc=(0, 0, -0.12))
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    log(f"Dodge: {len(act.fcurves)} fcurves")
    return act


def main():
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if not arm:
        log("ERROR: no armature found")
        sys.exit(1)
    log(f"armature={arm.name} loc={list(arm.location)} rot={list(arm.rotation_euler)}")
    names = {
        "Hips": "Hips", "Spine": "Spine", "Spine1": "Spine1", "Spine2": "Spine2",
        "Neck": "Bone_0x8023796d",
        "RightArm": "RightArm", "LeftArm": "LeftArm",
        "RFore": "Bone_0x7257a1aa", "LFore": "Bone_0x89b93a80",
        "RightUpLeg": "RightUpLeg", "LeftUpLeg": "LeftUpLeg",
        "RightLeg": "RightLeg", "LeftLeg": "LeftLeg",
        "RightFoot": "RightFoot", "LeftFoot": "LeftFoot",
    }
    missing = [v for v in names.values() if v not in arm.pose.bones]
    if missing:
        log(f"ERROR missing bones: {missing}")
        sys.exit(1)
    prep(arm, list(names.values()))
    B = {k: arm.pose.bones[v] for k, v in names.items()}
    for k, pb in B.items():
        log(f"  {k}: pitch=euler[{pb['pitch_idx']}] sign={pb['pitch_sign']:+.0f}")
    acts = [build_run(arm, B), build_idle(arm, B), build_jump(arm, B),
            build_walk(arm, B), build_hang(arm, B), build_climb(arm, B),
            build_dive(arm, B), build_hold(arm, B), build_crouch(arm, B),
            build_prone(arm, B), build_dodge(arm, B), build_slide(arm, B),
            build_rise(arm, B), build_fall(arm, B)]
    # stash to NLA so the glTF exporter emits all clips
    for a in acts:
        stash_to_nla(arm, a, 1)
    arm.animation_data.action = None
    log("actions stashed to NLA: " + ", ".join(a.name for a in acts))


main()
