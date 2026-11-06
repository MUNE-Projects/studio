#!/usr/bin/env python3
"""Prepara un modelo 3D de Poly Haven (glTF) para la biblioteca de MUNE, con Blender.

  python herramientas/modelos_blender.py <entrada.gltf> <salida.glb> [--triangulos 60000] [--textura 1024] [--solo pieza,pieza] [--muestra salida.png]

Como herramientas/modelos.py, pero además ALIGERA la geometría: los modelos de
plantas reales tienen cientos de miles de triángulos y la web pública tiene que
cargar rápido en un móvil. Reduce la malla (sin que se note a la distancia de
una foto) hasta el número de triángulos pedido, reduce las texturas y lo junta
todo en un .glb. Con --muestra, saca además una imagen de prueba del modelo.
Necesita Blender como módulo de Python (paquete «bpy», gratuito).
Los modelos de Poly Haven son CC0: se apuntan en biblioteca/licencias.md.
"""
import math, os, sys
import bpy
from mathutils import Vector

def arg(nombre, defecto):
    return type(defecto)(sys.argv[sys.argv.index(nombre) + 1]) if nombre in sys.argv else defecto

entrada, salida = (os.path.abspath(x) for x in sys.argv[1:3])
maximo, lado = arg('--triangulos', 60000), arg('--textura', 1024)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=entrada)
# --solo «leaves,stem»: quedarse solo con esas piezas (p. ej. el follaje sin la maceta)
solo = [x for x in arg('--solo', '').split(',') if x]
if solo:
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and not any(x in o.name for x in solo): bpy.data.objects.remove(o)
mallas = [o for o in bpy.context.scene.objects if o.type == 'MESH']
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
total = sum(tri(o) for o in mallas)
print('triángulos: %d en %d mallas' % (total, len(mallas)))
if total > maximo:
    ratio = maximo / total
    for o in mallas:
        m = o.modifiers.new('aligerar', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)
    print('aligerado a %d triángulos' % sum(tri(o) for o in mallas))
for im in bpy.data.images:
    if im.size[0] > lado:
        im.scale(lado, max(1, round(im.size[1] * lado / im.size[0])))
bpy.ops.export_scene.gltf(filepath=salida, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, export_apply=True)
print('%s: %d KB' % (salida, os.path.getsize(salida) // 1024))

muestra = arg('--muestra', '')
if muestra:
    esc = bpy.context.scene
    caja = [o.matrix_world @ Vector(v) for o in mallas for v in o.bound_box]
    lo = Vector((min(v.x for v in caja), min(v.y for v in caja), min(v.z for v in caja)))
    hi = Vector((max(v.x for v in caja), max(v.y for v in caja), max(v.z for v in caja)))
    centro, tam = (lo + hi) / 2, max((hi - lo).x, (hi - lo).y, (hi - lo).z)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); esc.collection.objects.link(cam); esc.camera = cam
    cam.location = centro + Vector((tam * 1.1, -tam * 1.6, tam * 0.7))
    cam.rotation_euler = (centro - cam.location).to_track_quat('-Z', 'Y').to_euler()
    luz = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN')); luz.data.energy = 4; esc.collection.objects.link(luz)
    luz.rotation_euler = (math.radians(50), 0, math.radians(30))
    esc.world = bpy.data.worlds.new('w'); esc.world.use_nodes = True
    esc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.9, 0.9, 0.88, 1)
    esc.render.engine = 'CYCLES'; esc.cycles.samples = 24; esc.cycles.use_denoising = True
    esc.render.resolution_x = esc.render.resolution_y = 320
    esc.render.filepath = os.path.abspath(muestra)
    bpy.ops.render.render(write_still=True)
    print('dimensiones (m): %.2f x %.2f x %.2f' % tuple(hi - lo))
