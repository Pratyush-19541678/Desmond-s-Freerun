"""Numerically solve symmetric arm poses (no more crossed hands).

Usage:
  blender.exe --background "AC1-Desmond_Miles.blend" \
    --python "tools/pose-solve.py"

For each (action, side, phase) it grid-searches shoulder euler values so the
arm tip points at an explicit world target (up + slightly out + forward),
then prints the winning euler triples to bake into animate-desmond.py.
Fully accounts for bone rolls, mirrored frames and euler-order coupling by
evaluating the composed matrices directly.
"""
import bpy
import math
from mathutils import Vector, Euler


def log(m):
    print(f"[pose-solve] {m}", flush=True)


PITCH_WORLD = Vector((0.0, 1.0, 0.0))


def pitch_axis(arm, bone_name):
    b = arm.data.bones[bone_name]
    m = b.matrix_local
    best, bi, bs = 0.0, 1, 1.0
    for idx in (0, 2):
        axis = Vector((m[0][idx], m[1][idx], m[2][idx])).normalized()
        d = axis.dot(PITCH_WORLD)
        if abs(d) > abs(best):
            best, bi, bs = d, idx, (1.0 if d > 0 else -1.0)
    return bi, bs


def set_pose(arm, values):
    """values: {bone_name: (ex, ey, ez)} absolute XYZ euler."""
    for n, e in values.items():
        pb = arm.pose.bones[n]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = e
    bpy.context.view_layer.update()


def tip_dir(arm, bone_name):
    """Armature-space direction of a pose bone (head->tail), evaluated."""
    dg = bpy.context.evaluated_depsgraph_get()
    arm_eval = arm.evaluated_get(dg)
    pb = arm_eval.pose.bones[bone_name]
    m = pb.matrix
    head = m @ Vector((0, 0, 0))
    tail = m @ Vector((0, 1, 0))
    return (tail - head).normalized()


def solve_arm(arm, bone_name, target, pitch_range, roll_range):
    """Grid-search euler triple minimizing angle(tip, target)."""
    pidx, _ = pitch_axis(arm, bone_name)
    ridx = 0 if pidx == 2 else 2
    tidx = 3 - pidx - ridx  # 0+1+2=3
    best = (1e9, None)
    p = pitch_range[0]
    while p <= pitch_range[1] + 1e-9:
        r = roll_range[0]
        while r <= roll_range[1] + 1e-9:
            e = [0.0, 0.0, 0.0]
            e[pidx] = p
            e[ridx] = r
            set_pose(arm, {bone_name: tuple(e)})
            d = tip_dir(arm, bone_name)
            ang = math.degrees(d.angle(target))
            if ang < best[0]:
                best = (ang, tuple(e))
            r += 0.1
        p += 0.1
    return best


def main():
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    # neutral ancestors (spine chain straight, as in hang-like poses)
    base = {
        "Hips": (0, 0, 0), "Spine": (0.06, 0, 0), "Spine1": (0.03, 0, 0),
        "Spine2": (0.02, 0, 0), "Bone_0x8023796d": (-0.1, 0, 0),
    }
    set_pose(arm, base)
    log("ancestor base set; solving (facing=-Y, up=+Z, right=-X)")

    jobs = [
        # (label, bone, target_xyz, pitch_range, roll_range)
        ("hang_R", "RightArm", (-0.30, -0.25, 0.92), (-3.0, -1.5), (-0.8, 0.8)),
        ("hang_L", "LeftArm", (0.30, -0.25, 0.92), (-3.0, -1.5), (-0.8, 0.8)),
        ("rise_R", "RightArm", (-0.28, -0.55, 0.79), (-2.6, -1.0), (-0.8, 0.8)),
        ("rise_L", "LeftArm", (0.28, -0.55, 0.79), (-2.6, -1.0), (-0.8, 0.8)),
        ("dive_R", "RightArm", (-0.65, -0.35, 0.67), (-2.6, -1.0), (-0.8, 0.8)),
        ("dive_L", "LeftArm", (0.65, -0.35, 0.67), (-2.6, -1.0), (-0.8, 0.8)),
    ]
    for label, bone, tgt, pr, rr in jobs:
        set_pose(arm, base)  # reset the other arm between solves
        ang, e = solve_arm(arm, bone, Vector(tgt).normalized(), pr, rr)
        set_pose(arm, {bone: e})
        d = tip_dir(arm, bone)
        log(f"{label}: euler=({e[0]:+.2f},{e[1]:+.2f},{e[2]:+.2f}) "
            f"tip={[round(v, 2) for v in d]} residual={ang:.1f}deg")


main()
