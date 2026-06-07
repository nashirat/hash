import bpy

obj = bpy.context.active_object
scene = bpy.context.scene

scene.frame_set(scene.frame_start)
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(depsgraph)
mesh = eval_obj.to_mesh()
vert_count_start = len(mesh.vertices)
eval_obj.to_mesh_clear()

scene.frame_set(scene.frame_end)
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(depsgraph)
mesh = eval_obj.to_mesh()
vert_count_end = len(mesh.vertices)
eval_obj.to_mesh_clear()

print(f"Frame 1 verts: {vert_count_start}")
print(f"Frame 250 verts: {vert_count_end}")
print(f"Match: {vert_count_start == vert_count_end}")
