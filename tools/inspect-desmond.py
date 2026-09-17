"""Dump armature bones + per-mesh bounds so we can build run/idle/jump actions."""
import bpy
import json
import sys


def log(m):
    print(f"[inspect] {m}", flush=True)


argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else None

info = {"bones": [], "meshes": []}
for o in bpy.data.objects:
    if o.type == "ARMATURE":
        log(f"ARMATURE {o.name} bones={len(o.data.bones)}")
        for b in o.data.bones:
            info["bones"].append({
                "name": b.name,
                "parent": b.parent.name if b.parent else None,
                "head": list(b.head_local),
                "tail": list(b.tail_local),
            })
            log(f"  bone {b.name} parent={b.parent.name if b.parent else '-'} "
                f"head={[round(v, 3) for v in b.head_local]}")
    elif o.type == "MESH":
        ws = [o.matrix_world @ v.co for v in o.data.vertices] if o.data.vertices else []
        if ws:
            mn = [min(v[i] for v in ws) for i in range(3)]
            mx = [max(v[i] for v in ws) for i in range(3)]
        else:
            mn = mx = [0, 0, 0]
        hidden = o.hide_viewport or o.hide_render
        info["meshes"].append({
            "name": o.name, "verts": len(o.data.vertices),
            "min": mn, "max": mx, "hidden": hidden,
            "loc": list(o.location),
        })
        log(f"  mesh {o.name} verts={len(o.data.vertices)} hidden={hidden} "
            f"loc={[round(v, 3) for v in o.location]} "
            f"bboxmin={[round(v, 3) for v in mn]} bboxmax={[round(v, 3) for v in mx]}")

if out:
    with open(out, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
    log(f"written {out}")
