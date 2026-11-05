#!/usr/bin/env python3
"""Render foto: la escena del visor calculada con trazado de rayos (Blender Cycles).

  python herramientas/render_foto.py <escena.glb> <escena.json> <salida.png> [--ancho 1600] [--muestras 256]

Necesita Blender como módulo de Python (paquete «bpy», gratuito, GPL). La
escena sale del visor (src/escena/exportarRender.ts): geometría en
coordenadas del mundo, cámara y sol. Cada material «mune:<acabado>:…» se
convierte en su material real: veta de roble, lino, microcemento, terrazo,
despiece de baldosas y lamas, vidrio…, con las texturas de src/texturas/.
"""
import json, math, os, sys
import bpy
from mathutils import Matrix, Quaternion, Vector

AQUI = os.path.dirname(os.path.abspath(__file__))
TEXTURAS = os.path.join(AQUI, '..', 'src', 'texturas')
TAM = {'roble': 1.83, 'microcemento': 1.5, 'terrazo': 2.0, 'lino': 0.27}

def arg(nombre, defecto):
    return type(defecto)(sys.argv[sys.argv.index(nombre) + 1]) if nombre in sys.argv else defecto

glb, js, salida = (os.path.abspath(x) for x in sys.argv[1:4])
ancho, muestras = arg('--ancho', 1600), arg('--muestras', 256)
datos = json.load(open(js))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
esc = bpy.context.scene

# ------------------------------------------------------------------ materiales

def hexrgb(h):
    h = h.lstrip('#')
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)

imagenes = {}
def imagen(n):
    if n not in imagenes:
        im = bpy.data.images.load(os.path.join(TEXTURAS, n + '.webp'))
        im.colorspace_settings.name = 'Non-Color'
        imagenes[n] = im
    return imagenes[n]

def material(nombre):
    p = nombre.split(':')
    acabado = p[1] if len(p) > 1 else 'liso'
    color = hexrgb(p[2]) if len(p) > 2 else (0.7, 0.7, 0.7, 1)
    rug = float(p[4]) if len(p) > 4 else 0.6
    v0, v3, v1 = (float(p[i]) if len(p) > i else 0 for i in (5, 6, 7))
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    L.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rug
    coord = N.new('ShaderNodeTexCoord')

    def real(n, escala=1.0, caja=True, giro=False):
        """Textura real: (claridad, rugosidad, altura) centradas en 0, en desviaciones."""
        mp = N.new('ShaderNodeMapping')
        L.new(coord.outputs['Object'], mp.inputs[0])
        s = escala / TAM[n]
        mp.inputs['Scale'].default_value = (s, s, s)
        if giro: mp.inputs['Rotation'].default_value = (0, 0, math.pi / 2)
        t = N.new('ShaderNodeTexImage'); t.image = imagen(n)
        t.projection = 'BOX' if caja else 'FLAT'; t.projection_blend = 0.25
        L.new(mp.outputs[0], t.inputs[0])
        sep = N.new('ShaderNodeSeparateColor'); L.new(t.outputs[0], sep.inputs[0])
        def z(salida):
            a = N.new('ShaderNodeMath'); a.operation = 'MULTIPLY_ADD'
            L.new(salida, a.inputs[0]); a.inputs[1].default_value = 1 / 0.15; a.inputs[2].default_value = -0.5 / 0.15
            return a.outputs[0]
        return z(sep.outputs[0]), z(sep.outputs[1]), z(sep.outputs[2])

    def tenir(claro, fuerza):
        """color × (1 + claro·fuerza)"""
        f = N.new('ShaderNodeMath'); f.operation = 'MULTIPLY_ADD'
        L.new(claro, f.inputs[0]); f.inputs[1].default_value = fuerza; f.inputs[2].default_value = 1
        mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1
        mix.inputs['A'].default_value = color
        cc = N.new('ShaderNodeCombineColor')
        for i in range(3): L.new(f.outputs[0], cc.inputs[i])
        L.new(cc.outputs[0], mix.inputs['B'])
        return mix.outputs['Result']

    def relieve(alto, fuerza, distancia=0.002):
        b = N.new('ShaderNodeBump'); b.inputs['Strength'].default_value = fuerza; b.inputs['Distance'].default_value = distancia
        L.new(alto, b.inputs['Height']); L.new(b.outputs[0], bsdf.inputs['Normal'])
        return b

    def despiece(ancho, largo, junta, color_salida, color_junta):
        """Lamas o baldosas (en planta): ladrillos de largo × ancho con junta."""
        if ancho <= 0 or largo <= 0: return color_salida
        br = N.new('ShaderNodeTexBrick')
        L.new(coord.outputs['Object'], br.inputs['Vector'])
        br.offset = 0.5 if largo > ancho * 1.5 else 0.0
        br.inputs['Scale'].default_value = 1.0
        br.inputs['Brick Width'].default_value = largo
        br.inputs['Row Height'].default_value = ancho
        br.inputs['Mortar Size'].default_value = max(junta, 0.0008)
        br.inputs['Mortar Smooth'].default_value = 0.2
        L.new(color_salida, br.inputs['Color1']); L.new(color_salida, br.inputs['Color2'])
        br.inputs['Mortar'].default_value = color_junta
        # la junta, un poco hundida
        inv = N.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1
        L.new(br.outputs['Fac'], inv.inputs[1])
        b = N.new('ShaderNodeBump'); b.inputs['Strength'].default_value = 0.4; b.inputs['Distance'].default_value = 0.001
        L.new(inv.outputs[0], b.inputs['Height']); L.new(b.outputs[0], bsdf.inputs['Normal'])
        return br.outputs['Color']

    oscuro = tuple(c * 0.55 for c in color[:3]) + (1,)
    if acabado == 'laminado' and v0 < 0.05:
        # frentes lacados: liso, satinado
        bsdf.inputs['Roughness'].default_value = 0.35
    elif acabado in ('tarima', 'madera', 'laminado'):
        claro, rg, alto = real('roble', giro=(acabado == 'tarima'))
        col = tenir(claro, 0.16)
        if acabado == 'tarima': col = despiece(v0, v3, v1, col, oscuro)
        L.new(col, bsdf.inputs['Base Color'])
        r = N.new('ShaderNodeMath'); r.operation = 'MULTIPLY_ADD'; L.new(rg, r.inputs[0]); r.inputs[1].default_value = 0.05; r.inputs[2].default_value = rug
        L.new(r.outputs[0], bsdf.inputs['Roughness'])
        if acabado != 'tarima': relieve(alto, 0.15)
        bsdf.inputs['Coat Weight'].default_value = 0.15 if acabado != 'laminado' else 0.0
    elif acabado in ('textil', 'boucle'):
        claro, rg, alto = real('lino', escala=1.0 if acabado == 'textil' else 0.6)
        L.new(tenir(claro, 0.12), bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
        bsdf.inputs['Sheen Weight'].default_value = 0.8
        bsdf.inputs['Sheen Roughness'].default_value = 0.45
        relieve(alto, 0.6, 0.0015)
    elif acabado == 'pintura':
        claro, rg, alto = real('microcemento', escala=2.3)
        L.new(tenir(claro, 0.008), bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.85
        relieve(alto, 0.05, 0.001)
    elif acabado in ('porcelanico', 'alicatado'):
        aspecto = int(float(p[8])) if len(p) > 8 else 0
        if aspecto == 4:   # imitación madera
            claro, rg, alto = real('roble', giro=True); col = tenir(claro, 0.16)
        elif aspecto == 5: # terrazo
            claro, rg, alto = real('terrazo'); col = tenir(claro, 0.16)
        elif aspecto == 3: # cemento
            claro, rg, alto = real('microcemento'); col = tenir(claro, 0.05)
        else:
            claro, rg, alto = real('microcemento', escala=0.7); col = tenir(claro, 0.012)
        if acabado == 'porcelanico': col = despiece(v0, v3, v1, col, tuple(c * 0.8 for c in color[:3]) + (1,))
        L.new(col, bsdf.inputs['Base Color'])
    elif acabado == 'vidrio':
        N.remove(bsdf)
        tr = N.new('ShaderNodeBsdfTransparent'); gl = N.new('ShaderNodeBsdfGlossy'); gl.inputs['Roughness'].default_value = 0.02
        fr = N.new('ShaderNodeLayerWeight'); fr.inputs['Blend'].default_value = 0.15
        mx = N.new('ShaderNodeMixShader')
        L.new(fr.outputs['Fresnel'], mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(gl.outputs[0], mx.inputs[2])
        L.new(mx.outputs[0], out.inputs[0])
    elif acabado == 'lienzo':
        # lienzo abstracto: manchas grandes de sus colores, con borde de pincel
        ns = N.new('ShaderNodeTexNoise'); ns.inputs['Scale'].default_value = 1.6; ns.inputs['Detail'].default_value = 3
        L.new(coord.outputs['Object'], ns.inputs['Vector'])
        rampa = N.new('ShaderNodeValToRGB'); L.new(ns.outputs['Fac'], rampa.inputs[0])
        el = rampa.color_ramp.elements; el[0].position = 0.47; el[0].color = color; el[1].position = 0.5
        el[1].color = hexrgb(p[3]) if len(p) > 3 else (0.3, 0.4, 0.3, 1)
        L.new(rampa.outputs[0], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = 0.8
    elif acabado == 'cuarzo':
        bsdf.inputs['Roughness'].default_value = 0.15
        bsdf.inputs['Coat Weight'].default_value = 0.3
    elif acabado == 'marmol':
        bsdf.inputs['Roughness'].default_value = 0.1
        bsdf.inputs['Coat Weight'].default_value = 0.4
    return m

cambiados = {}
for ob in esc.objects:
    if ob.type != 'MESH': continue
    for ranura in ob.material_slots:
        mt = ranura.material
        if not mt: continue
        if mt.name.startswith('mune:'):
            if mt.name not in cambiados: cambiados[mt.name] = material(mt.name)
            ranura.material = cambiados[mt.name]
        elif mt.blend_method in ('BLEND', 'HASHED') and mt.name.startswith('mune'):
            pass
print('materiales:', len(cambiados))

# ------------------------------------------------------------------ cámara

def a_blender(v):  # three (y arriba) -> Blender (z arriba)
    return Vector((v[0], -v[2], v[1]))

c = datos['camara']
cam = bpy.data.cameras.new('camara'); cam.lens_unit = 'FOV'
ob = bpy.data.objects.new('camara', cam); esc.collection.objects.link(ob)
ob.location = a_blender(c['posicion'])
qx, qy, qz, qw = c['cuaternion']
ob.rotation_mode = 'QUATERNION'
ob.rotation_quaternion = Quaternion((math.cos(math.pi / 4), math.sin(math.pi / 4), 0, 0)) @ Quaternion((qw, qx, qy, qz))
alto = round(ancho / c['aspecto'])
cam.sensor_fit = 'VERTICAL'
cam.angle = math.radians(c['fov'])
cam.clip_start = 0.05
esc.camera = ob
esc.render.resolution_x, esc.render.resolution_y = ancho, alto

# ------------------------------------------------------------------ sol y cielo

d = a_blender(datos['sol']['direccion']).normalized()

def elegir_sol(cam_ob, elevacion=math.radians(arg('--altura-sol', 32.0))):
    """Como un fotógrafo que elige la hora: prueba el sol alrededor de la casa y
    se queda con la dirección que mete más sol en el suelo que se ve en la foto."""
    dg = bpy.context.evaluated_depsgraph_get()
    cam_ob.data.sensor_fit = 'VERTICAL'
    m = cam_ob.matrix_world
    origen = m.translation
    th = math.tan(cam_ob.data.angle / 2); tw = th * c['aspecto']
    def rayo(p, v, saltos=6):
        # atraviesa los vidrios (como la luz)
        for _ in range(saltos):
            hit, loc, nor, idx, ob, _m = esc.ray_cast(dg, p, v)
            if not hit: return None
            mat = ob.active_material.name if ob and ob.active_material else ''
            if 'vidrio' in mat: p = loc + v * 0.002; continue
            return loc, nor
        return None
    suelo = []
    for j in range(14):
        for i in range(22):
            x = (i + 0.5) / 22 * 2 - 1; y = (j + 0.5) / 14 * 2 - 1
            v = (m.to_3x3() @ Vector((x * tw, y * th, -1))).normalized()
            r = rayo(origen, v)
            if r and r[1].z > 0.8: suelo.append(r[0] + r[1] * 0.002)
    if not suelo: return None, 0
    mejor, cuenta = None, -1
    for k in range(24):
        az = k / 24 * 2 * math.pi
        dsol = Vector((math.cos(elevacion) * math.sin(az), math.cos(elevacion) * math.cos(az), math.sin(elevacion)))
        n = sum(1 for p in suelo if rayo(p, dsol) is None)
        if n > cuenta: mejor, cuenta = dsol, n
    return mejor, cuenta / len(suelo)

if '--sol-fijo' not in sys.argv:
    elegido, parte = elegir_sol(ob)
    if elegido is not None and parte > 0.03:
        d = elegido
        print('sol elegido: %.0f%% del suelo visible al sol' % (parte * 100))
sol = bpy.data.lights.new('sol', 'SUN'); sol.energy = arg('--fuerza-sol', 5.0); sol.angle = math.radians(1.5)
so = bpy.data.objects.new('sol', sol); esc.collection.objects.link(so)
so.rotation_mode = 'QUATERNION'; so.rotation_quaternion = (-d).to_track_quat('-Z', 'Y')
mundo = bpy.data.worlds.new('cielo'); esc.world = mundo; mundo.use_nodes = True
W = mundo.node_tree.nodes; WL = mundo.node_tree.links
cielo = W.new('ShaderNodeTexSky')
try:
    tipos = [x.identifier for x in cielo.bl_rna.properties['sky_type'].enum_items]
    cielo.sky_type = 'NISHITA' if 'NISHITA' in tipos else 'MULTIPLE_SCATTERING'
    cielo.sun_disc = False
    cielo.sun_elevation = math.asin(max(d.z, 0.05))
    cielo.sun_rotation = math.atan2(d.x, d.y)
except Exception as e:
    print('cielo simple:', e)
fondo = W['Background']; fondo.inputs['Strength'].default_value = arg('--cielo', 1.0)
WL.new(cielo.outputs[0], fondo.inputs[0])

# ------------------------------------------------------------------ render

esc.render.engine = 'CYCLES'
esc.cycles.device = 'CPU'
esc.cycles.samples = muestras
esc.cycles.use_denoising = True
esc.cycles.max_bounces = 8
esc.cycles.diffuse_bounces = 5
esc.cycles.glossy_bounces = 3
esc.cycles.transparent_max_bounces = 8
esc.cycles.caustics_reflective = False
esc.cycles.caustics_refractive = False
esc.view_settings.view_transform = 'AgX'
esc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [x.identifier for x in esc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
esc.view_settings.exposure = arg('--exposicion', 2.3)
# contraste suave de fotografía (curva en S): negros con cuerpo sin quemar los blancos
try:
    esc.view_settings.use_curve_mapping = True
    curva = esc.view_settings.curve_mapping.curves[3]
    curva.points[0].location = (0.0, 0.0); curva.points[1].location = (1.0, 1.0)
    curva.points.new(0.25, 0.21); curva.points.new(0.75, 0.79)
    esc.view_settings.curve_mapping.update()
except Exception as e:
    print('sin curva de contraste:', e)
# equilibrio de blancos de fotógrafo de interiores: el cielo azul no enfría la estancia
try:
    esc.view_settings.use_white_balance = True
    esc.view_settings.white_balance_temperature = arg('--temperatura', 7200.0)
except Exception as e:
    print('sin equilibrio de blancos:', e)
# exposímetro de fotógrafo: un render pequeño y rápido mide la luz media de la
# vista y se abre o se cierra el «diafragma» para que la estancia se vea clara
if '--exposicion' not in sys.argv:
    import numpy as np
    esc.render.resolution_percentage = 15
    esc.cycles.samples = 16
    esc.cycles.use_denoising = False
    esc.render.image_settings.file_format = 'OPEN_EXR'
    medida = os.path.join(os.path.dirname(salida), '.medida.exr')
    esc.render.filepath = medida
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(medida)
    px = np.array(im.pixels[:]).reshape(-1, 4)[:, :3]
    l = px @ np.array([0.2126, 0.7152, 0.0722])
    lum = max(float(np.percentile(l, 45)), float(np.mean(l)) * 0.3, 1e-4)  # la estancia, no la ventana; nunca cero
    esc.view_settings.exposure = float(np.clip(np.log2(arg('--brillo', 0.2) / lum), -2, 9))
    print('exposición automática: %.2f (luz media %.4f)' % (esc.view_settings.exposure, lum))
    os.remove(medida)
    esc.render.resolution_percentage = 100
    esc.cycles.samples = muestras
    esc.cycles.use_denoising = True
esc.render.image_settings.file_format = 'PNG'
esc.render.filepath = salida
bpy.ops.render.render(write_still=True)
print('listo', salida)
