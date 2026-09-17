"""Repair the Desmond rig for headless export.

The .blend's armature object carries a corrupted viewport-visibility flag
(visible_get() is False even with hide_viewport=False, so the glTF exporter
skips it -> no skin, no animations). Fix: duplicate the armature object+data
(the copy reports visible), retarget every mesh (parent + Armature modifiers)
to the copy, then delete the broken original. Bone names are preserved, so
vertex groups / skinning survive untouched. In-memory only, .blend not saved.
"""
import bpy


def log(m):
    print(f"[fixrig] {m}", flush=True)


def main():
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        log("no armature, nothing to fix")
        return
    log(f"original {arm.name} visible_get={arm.visible_get()}")

    dup = arm.copy()
    dup.data = arm.data.copy()
    dup.name = "Reference"
    arm.name = "Reference_BROKEN_ORIGINAL"
    bpy.context.scene.collection.objects.link(dup)
    dup.parent = arm.parent
    dup.matrix_world = arm.matrix_world.copy()
    dup.hide_viewport = False
    dup.hide_render = False
    dup.hide_select = False
    bpy.context.view_layer.update()
    log(f"copy visible_get={dup.visible_get()} bones={len(dup.data.bones)}")

    if not dup.visible_get():
        log("ERROR: copy is still invisible, aborting")
        raise SystemExit(1)

    # retarget meshes: parent + armature modifiers
    for m in [o for o in bpy.data.objects if o.type == "MESH"]:
        if m.parent == arm:
            mw = m.matrix_world.copy()
            m.parent = dup
            m.matrix_world = mw
        for mod in m.modifiers:
            if mod.type == "ARMATURE" and mod.object == arm:
                mod.object = dup
    log("meshes retargeted to copy")

    # drop the broken original (data kept by copy)
    bpy.data.objects.remove(arm)
    bpy.context.view_layer.update()
    log("original removed; armatures now: "
        f"{[o.name for o in bpy.data.objects if o.type == 'ARMATURE']}")


main()
