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

# protección frente a la IA, por acabado: lo que define la memoria de calidades
# (suelos, revestimientos, encimeras) y lo que la IA tiende a inventarse (cuadros)
PROTEGER = {'lienzo': 1.0, 'tarima': 0.8, 'porcelanico': 0.8, 'alicatado': 0.8, 'cuarzo': 0.8, 'laminado': 0.6,
            'marmol': 0.8, 'puerta': 0.6, 'vidrio': 0.62, 'exterior': 0.5, 'textil': 0.55, 'boucle': 0.55, 'pantalla': 0.3}
VENTANAS = []  # nodos del cristal que oscurecen lo que se ve por la ventana
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
        # escala de la trama (v0): 1 = tapicería fina; menos = punto grueso de manta
        # (en la biblioteca, las mantas y plaids llevan escala 3: se dibujan como punto grueso)
        escala_t = 0.45 if acabado == 'textil' and v0 >= 2 else (1.0 if acabado == 'textil' else 0.6)
        claro, rg, alto = real('lino', escala=escala_t)
        L.new(tenir(claro, 0.12 if escala_t >= 0.9 else 0.25), bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
        bsdf.inputs['Sheen Weight'].default_value = 0.8
        bsdf.inputs['Sheen Roughness'].default_value = 0.45
        relieve(alto, 0.6 if escala_t >= 0.9 else 1.0, 0.0015 / max(escala_t, 0.3))
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
        # lo que la cámara ve a través del cristal, más oscuro (como el fotógrafo que expone
        # aparte la ventana); la luz que entra en la habitación no cambia
        lp = N.new('ShaderNodeLightPath')
        vista = N.new('ShaderNodeMix'); vista.data_type = 'RGBA'
        L.new(lp.outputs['Is Camera Ray'], vista.inputs['Factor'])
        vista.inputs['A'].default_value = (1, 1, 1, 1)
        k = arg('--ventana', 0.45); vista.inputs['B'].default_value = (k, k, k, 1)
        VENTANAS.append((vista, k))
        L.new(vista.outputs['Result'], tr.inputs['Color'])
        fr = N.new('ShaderNodeLayerWeight'); fr.inputs['Blend'].default_value = 0.15
        mx = N.new('ShaderNodeMixShader')
        L.new(fr.outputs['Fresnel'], mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(gl.outputs[0], mx.inputs[2])
        L.new(mx.outputs[0], out.inputs[0])
    elif acabado == 'lienzo':
        # pintura abstracta: grandes campos de color con trazos de pincel y textura de lienzo
        c2 = hexrgb(p[3]) if len(p) > 3 else (0.3, 0.4, 0.3, 1)
        claro_l = tuple(min(1, x * 1.35 + 0.08) for x in color[:3]) + (1,)
        mp = N.new('ShaderNodeMapping'); L.new(coord.outputs['Object'], mp.inputs[0])
        mp.inputs['Scale'].default_value = (1.2, 1.2, 1.2)
        # el trazo: ruido estirado en una dirección (como una brocha ancha)
        tr = N.new('ShaderNodeTexNoise'); tr.inputs['Scale'].default_value = 1.4; tr.inputs['Detail'].default_value = 6
        tr.inputs['Roughness'].default_value = 0.62; tr.inputs['Distortion'].default_value = 0.9
        es = N.new('ShaderNodeMapping'); es.inputs['Scale'].default_value = (1.0, 5.0, 1.0)
        L.new(mp.outputs[0], es.inputs[0]); L.new(es.outputs[0], tr.inputs['Vector'])
        manchas = N.new('ShaderNodeTexNoise'); manchas.inputs['Scale'].default_value = 0.9; manchas.inputs['Detail'].default_value = 2
        L.new(mp.outputs[0], manchas.inputs['Vector'])
        mezcla = N.new('ShaderNodeMath'); mezcla.operation = 'MULTIPLY_ADD'
        L.new(tr.outputs['Fac'], mezcla.inputs[0]); mezcla.inputs[1].default_value = 0.35; L.new(manchas.outputs['Fac'], mezcla.inputs[2])
        rampa = N.new('ShaderNodeValToRGB'); L.new(mezcla.outputs[0], rampa.inputs[0])
        el = rampa.color_ramp.elements
        el[0].position = 0.5; el[0].color = claro_l
        el[1].position = 0.58; el[1].color = color
        e3 = el.new(0.72); e3.color = c2
        e4 = el.new(0.8); e4.color = tuple(x * 0.85 for x in c2[:3]) + (1,)
        claro, rg, alto = real('lino', escala=0.6)
        L.new(rampa.outputs[0], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.75
        # relieve: el lienzo y el grosor del trazo
        suma = N.new('ShaderNodeMath'); suma.operation = 'MULTIPLY_ADD'
        L.new(tr.outputs['Fac'], suma.inputs[0]); suma.inputs[1].default_value = 2.0; L.new(alto, suma.inputs[2])
        relieve(suma.outputs[0], 0.25, 0.0008)
    elif acabado == 'pantalla':
        # pantalla de tela: deja pasar la luz de la bombilla, cálida
        N.remove(bsdf)
        dif = N.new('ShaderNodeBsdfDiffuse'); dif.inputs['Color'].default_value = color
        trl = N.new('ShaderNodeBsdfTranslucent'); trl.inputs['Color'].default_value = tuple(min(1, c * 1.05) for c in color[:3]) + (1,)
        mx = N.new('ShaderNodeMixShader'); mx.inputs[0].default_value = 0.45
        L.new(dif.outputs[0], mx.inputs[1]); L.new(trl.outputs[0], mx.inputs[2])
        L.new(mx.outputs[0], out.inputs[0])
    elif acabado == 'exterior':
        # jardín de la urbanización: césped con manchas de color y briznas (lo que en el visor es procedural)
        ns = N.new('ShaderNodeTexNoise'); ns.inputs['Scale'].default_value = 0.6; ns.inputs['Detail'].default_value = 8
        L.new(coord.outputs['Object'], ns.inputs['Vector'])
        rampa = N.new('ShaderNodeValToRGB'); L.new(ns.outputs['Fac'], rampa.inputs[0])
        el = rampa.color_ramp.elements
        el[0].position = 0.35; el[0].color = (0.09, 0.14, 0.045, 1)
        el[1].position = 0.7; el[1].color = (0.2, 0.26, 0.09, 1)
        L.new(rampa.outputs[0], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
        brizna = N.new('ShaderNodeTexNoise'); brizna.inputs['Scale'].default_value = 400
        L.new(coord.outputs['Object'], brizna.inputs['Vector'])
        relieve(brizna.outputs['Fac'], 0.4, 0.004)
    elif acabado == 'cuarzo':
        bsdf.inputs['Roughness'].default_value = 0.15
        bsdf.inputs['Coat Weight'].default_value = 0.3
    elif acabado == 'marmol':
        bsdf.inputs['Roughness'].default_value = 0.1
        bsdf.inputs['Coat Weight'].default_value = 0.4
    # bombillas y piezas que dan luz: encendidas, cálidas
    emision = float(p[9]) if len(p) > 9 else 0.0
    if emision > 0 and acabado not in ('vidrio', 'pantalla'):
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.78, 0.52, 1)
        bsdf.inputs['Emission Strength'].default_value = emision * arg('--lamparas', 6.0)
    # cuánto hay que proteger este acabado de la pasada de IA (herramientas/foto_ia.py):
    # 1 = no se toca (cuadros), 0 = la IA puede darle textura y luz libremente
    proteger = PROTEGER.get(acabado, 0.0)
    if nombre.endswith(':alfombra'): proteger = 0.7  # la IA la funde con el suelo
    aov = N.new('ShaderNodeOutputAOV'); aov.aov_name = 'proteger'
    aov.inputs['Value'].default_value = proteger
    # un color distinto por material: de ahí salen los bordes exactos de cada cosa
    # (alfombra, cabecero, zócalo…) aunque en la imagen apenas contrasten
    import hashlib
    hsh = hashlib.md5(nombre.encode()).digest()
    ids = N.new('ShaderNodeOutputAOV'); ids.aov_name = 'materiales'
    ids.inputs['Color'].default_value = (hsh[0] / 255, hsh[1] / 255, hsh[2] / 255, 1)
    return m

cambiados = {}
for ob in esc.objects:
    if ob.type != 'MESH': continue
    for ranura in ob.material_slots:
        mt = ranura.material
        if not mt: continue
        if mt.name.startswith('mune:'):
            # las alfombras, con su propio material: la pasada de IA las trata aparte
            nombre = mt.name + (':alfombra' if 'alfombra' in ob.name.lower() else '')
            if nombre not in cambiados: cambiados[nombre] = material(nombre)
            ranura.material = cambiados[nombre]
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

def camara_de_fotografo(ob, altura=arg('--altura-camara', 1.3)):
    """Como un fotógrafo de interiores: cámara a ~1,30 m del suelo y nivelada
    (verticales rectas). Lo que la vista miraba hacia arriba o abajo se recupera
    descentrando el objetivo, como una cámara de arquitectura, sin inclinarla."""
    dg = bpy.context.evaluated_depsgraph_get()
    m = ob.matrix_world.copy()
    fwd = (m.to_3x3() @ Vector((0, 0, -1))).normalized()
    hit, loc, nor, *_ = esc.ray_cast(dg, ob.location, Vector((0, 0, -1)))
    suelo = loc.z if hit else ob.location.z - 1.5
    cabeza = ob.location.z - suelo
    # la vista miraba al punto donde cruzaba la altura de sus ojos; se conserva el encuadre
    inclinacion = math.asin(max(-0.95, min(0.95, fwd.z)))
    ob.location.z = suelo + altura
    rumbo = math.atan2(-fwd.x, fwd.y)
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler = (math.pi / 2, 0, rumbo)
    vfov = ob.data.angle
    desplazamiento = math.tan(inclinacion) / (2 * math.tan(vfov / 2) * c['aspecto'])
    # al bajar la cámara, el centro de la imagen sube un poco para no ver tanto suelo
    desplazamiento += (cabeza - altura) * 0.02
    ob.data.shift_y = max(-0.2, min(0.2, desplazamiento))
    print('cámara de fotógrafo: %.2f m del suelo, descentrado %.3f (antes %.2f m e inclinada %.0f°)' % (altura, ob.data.shift_y, cabeza, math.degrees(inclinacion)))

if '--camara-visor' not in sys.argv:
    camara_de_fotografo(ob)

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
# el cielo, menos azul dentro de casa: mezcla con luz blanca cálida (como el balance de blancos de un fotógrafo)
calido = W.new('ShaderNodeMix'); calido.data_type = 'RGBA'
calido.inputs['Factor'].default_value = arg('--neutro', 0.45)
WL.new(cielo.outputs[0], calido.inputs['A']); calido.inputs['B'].default_value = (1.0, 0.93, 0.84, 1)
# conservar la intensidad del cielo: el blanco toma el brillo del cielo
brillo = W.new('ShaderNodeRGBToBW'); WL.new(cielo.outputs[0], brillo.inputs[0])
tinte = W.new('ShaderNodeMix'); tinte.data_type = 'RGBA'; tinte.blend_type = 'MULTIPLY'; tinte.inputs['Factor'].default_value = 1
WL.new(brillo.outputs[0], tinte.inputs['A']); tinte.inputs['B'].default_value = (1.0, 0.93, 0.84, 1)
WL.new(tinte.outputs['Result'], calido.inputs['B'])
WL.new(calido.outputs['Result'], fondo.inputs[0])
# «ventana» de fotógrafo: el cielo que se ve por la ventana, menos brillante (no ilumina menos la casa)
camino = W.new('ShaderNodeLightPath')
fuerza = W.new('ShaderNodeMath'); fuerza.operation = 'MULTIPLY_ADD'
WL.new(camino.outputs['Is Camera Ray'], fuerza.inputs[0]); fuerza.inputs[1].default_value = arg('--cielo-visto', 0.35) - 1; fuerza.inputs[2].default_value = 1
por = W.new('ShaderNodeMath'); por.operation = 'MULTIPLY'
WL.new(fuerza.outputs[0], por.inputs[0]); por.inputs[1].default_value = arg('--cielo', 1.0)
WL.new(por.outputs[0], fondo.inputs['Strength'])

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
    # se mide la estancia como es, sin el oscurecido de la ventana
    for nodo, _k in VENTANAS: nodo.inputs['B'].default_value = (1, 1, 1, 1)
    esc.render.filepath = medida
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(medida)
    px = np.array(im.pixels[:]).reshape(-1, 4)[:, :3]
    l = px @ np.array([0.2126, 0.7152, 0.0722])
    # el brillo típico de la estancia: sin las ventanas y el sol directo (lo más claro)
    # ni el grano oscuro de pocas muestras (lo más oscuro); media geométrica del resto
    bajo, alto_p = np.percentile(l, 10), np.percentile(l, 85)
    medio = l[(l >= bajo) & (l <= alto_p)]
    lum = float(np.exp(np.mean(np.log(np.maximum(medio, 1e-4))))) if medio.size else 1e-3
    # margen máximo de corrección: ninguna estancia quemada ni a oscuras
    esc.view_settings.exposure = float(np.clip(np.log2(arg('--brillo', 0.24) / lum), arg('--exp-min', 0.5), arg('--exp-max', 2.0)))
    print('exposición automática: %.2f (luz media %.4f)' % (esc.view_settings.exposure, lum))
    os.remove(medida)
    for nodo, k in VENTANAS: nodo.inputs['B'].default_value = (k, k, k, 1)
    esc.render.resolution_percentage = 100
    esc.cycles.samples = muestras
    esc.cycles.use_denoising = True
esc.render.image_settings.file_format = 'PNG'
esc.render.filepath = salida
bpy.ops.render.render(write_still=True)

# ------------------------------------------------------------------ descripción de la escena (para la IA)
# qué se ve en la foto y con qué acabado, para decírselo a la IA en sus palabras:
# así no confunde materiales (madera en un armario lacado, botones en un cabecero liso)
OBJETOS = [('cama', 'bed'), ('cabecero', 'headboard'), ('armario', 'wardrobe'), ('sofa', 'sofa'), ('sillon', 'armchair'),
           ('mesilla', 'nightstand'), ('mesa', 'table'), ('silla', 'chair'), ('alfombra', 'rug'), ('cuadro', 'framed painting'),
           ('lampara', 'lamp'), ('cocina', 'kitchen cabinets'), ('encimera', 'countertop'), ('balconera', 'window frame'),
           ('ventana', 'window frame'), ('puerta', 'door'), ('suelo', 'floor'), ('muros', 'walls'), ('techo', 'ceiling'),
           ('banera', 'bathtub'), ('ducha', 'shower'), ('lavabo', 'washbasin'), ('inodoro', 'toilet'), ('planta', 'plant'),
           ('jardinera', 'planter'), ('mueble', 'cabinet'), ('televisor', 'tv'), ('cortina', 'curtain')]
ACABADO_EN = {'tarima': 'wood plank', 'madera': 'wood', 'laminado': 'lacquered', 'pintura': 'painted', 'liso': 'matte',
              'textil': 'linen', 'boucle': 'boucle', 'porcelanico': 'porcelain tile', 'alicatado': 'ceramic tile',
              'marmol': 'marble', 'cuarzo': 'quartz', 'sate': 'rendered', 'lienzo': 'abstract', 'puerta': 'lacquered',
              'pantalla': 'linen', 'hoja': 'green'}
COLORES = [('white', (245, 245, 242)), ('off-white', (232, 226, 214)), ('beige', (212, 196, 172)), ('light grey', (190, 190, 188)),
           ('grey', (128, 128, 126)), ('dark grey', (64, 66, 68)), ('black', (25, 25, 25)), ('light oak', (196, 160, 118)),
           ('oak', (170, 128, 88)), ('walnut', (110, 78, 55)), ('terracotta', (190, 110, 80)), ('blush pink', (230, 170, 155)),
           ('sage green', (150, 165, 135)), ('olive green', (95, 110, 65)), ('navy blue', (40, 50, 80)), ('light blue', (165, 190, 210)),
           ('camel', (184, 160, 122)), ('taupe', (150, 135, 120))]

def describir_escena():
    dg = bpy.context.evaluated_depsgraph_get()
    m = ob.matrix_world; origen = m.translation
    th = math.tan(ob.data.angle / 2); tw = th * c['aspecto']; sy = ob.data.shift_y * 2 * tw
    cuenta = {}
    for j in range(24):
        for i in range(36):
            x = (i + 0.5) / 36 * 2 - 1; y = (j + 0.5) / 24 * 2 - 1
            v = (m.to_3x3() @ Vector((x * tw, y * th + sy, -1))).normalized()
            hit, loc, nor, idx, o, _m = esc.ray_cast(dg, origen, v)
            if not hit or not o: continue
            mat = o.active_material.name if o.active_material else ''
            if 'vidrio' in mat: continue
            nombre = o.name.lower()
            obj = next((en for es, en in OBJETOS if es in nombre), None)
            if obj is None:
                obj = 'floor' if nor.z > 0.8 else 'ceiling' if nor.z < -0.8 else None
            if obj is None or not mat.startswith('mune:'): continue
            partes = mat.split(':')
            acabado = ACABADO_EN.get(partes[1], '')
            h = partes[2].lstrip('#'); rgb = tuple(int(h[k:k + 2], 16) for k in (0, 2, 4))
            madera = partes[1] in ('tarima', 'madera')
            # los nombres de madera solo para la madera: una alfombra «roble» la convierte en madera
            color = min((cn for cn in COLORES if madera or cn[0] not in ('light oak', 'oak', 'walnut')),
                        key=lambda cn: sum((a - b) ** 2 for a, b in zip(cn[1], rgb)))[0]
            if madera and color in ('beige', 'off-white'): color = 'light oak'
            frase = f'{color} {acabado} {obj}'.replace('  ', ' ').strip()
            cuenta[frase] = cuenta.get(frase, 0) + 1
    vistas = [f for f, n in sorted(cuenta.items(), key=lambda x: -x[1]) if n >= 4][:7]
    return vistas

# ------------------------------------------------------------------ mapa de profundidad (para la IA)
# --profundidad salida.png: a qué distancia está cada punto (claro = cerca), para
# que la pasada de IA (herramientas/foto_ia.py) respete la forma exacta de la estancia
prof = arg('--profundidad', '')
if prof:
    import glob, numpy as np
    # OpenImageIO viene con Blender (dentro del paquete bpy)
    raiz_blender = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(bpy.__file__))))  # …/bpy/5.x
    sys.path += glob.glob(os.path.join(raiz_blender, 'python', 'lib', 'python3*', 'site-packages'))
    import OpenImageIO as oiio
    from PIL import Image
    esc.cycles.samples = 1
    esc.cycles.use_denoising = False
    bpy.context.view_layer.use_pass_z = True
    if 'proteger' not in [a.name for a in bpy.context.view_layer.aovs]:
        a = bpy.context.view_layer.aovs.add(); a.name = 'proteger'; a.type = 'VALUE'
    if 'materiales' not in [a.name for a in bpy.context.view_layer.aovs]:
        a = bpy.context.view_layer.aovs.add(); a.name = 'materiales'; a.type = 'COLOR'
    try:
        esc.render.image_settings.media_type = 'MULTI_LAYER_IMAGE'  # Blender 5
    except Exception:
        pass
    esc.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER' if 'OPEN_EXR_MULTILAYER' in [x.identifier for x in esc.render.image_settings.bl_rna.properties['file_format'].enum_items] else 'OPEN_EXR'
    tmp = os.path.join(os.path.dirname(salida), '.profundidad.exr')
    esc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    # la profundidad va en su propia capa del EXR (en Blender 5, otra subimagen)
    z = None
    for sub in range(oiio.ImageBuf(tmp).nsubimages or 1):
        buf = oiio.ImageBuf(tmp, sub, 0)
        canales = list(buf.spec().channelnames)
        for ic, n in enumerate(canales):
            if n.endswith('Depth.Z') or n == 'Z':
                z = buf.get_pixels(oiio.FLOAT)[:, :, ic]
            if n.endswith('materiales.R'):
                mt = np.clip(buf.get_pixels(oiio.FLOAT)[:, :, ic:ic + 3], 0, 1)
                Image.fromarray((mt * 255).astype(np.uint8)).save(os.path.abspath(prof).replace('.png', '-materiales.png'))
            if 'proteger' in n:
                pr = np.clip(buf.get_pixels(oiio.FLOAT)[:, :, ic], 0, 1)
                Image.fromarray((pr * 255).astype(np.uint8)).save(os.path.abspath(prof).replace('.png', '-proteger.png'))
    if z is None: raise RuntimeError('El render no ha guardado la profundidad')
    z = np.clip(z, 0, 30)
    cerca, lejos = np.percentile(z, 1), np.percentile(z, 98)
    d = 1 - np.clip((z - cerca) / max(lejos - cerca, 1e-3), 0, 1)
    Image.fromarray((d * 255).astype(np.uint8)).save(os.path.abspath(prof))
    os.remove(tmp)
    with open(os.path.abspath(prof).replace('.png', '-escena.txt'), 'w') as f:
        f.write(', '.join(describir_escena()))
    print('profundidad:', prof)

# ------------------------------------------------------------------ revelado de fotógrafo
# lo que hace una cámara real: un poco de brillo alrededor de las luces fuertes,
# viñeta suave, la mínima aberración del objetivo y un grano finísimo
if '--sin-revelado' not in sys.argv:
    import numpy as np
    from PIL import Image, ImageFilter
    im = Image.open(salida).convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255
    h, w = a.shape[:2]
    # brillo (bloom): lo muy claro se difumina y se suma
    luz = np.clip((a - 0.82) / 0.18, 0, 1) * a
    halo = np.asarray(Image.fromarray((luz * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=w / 90))).astype(np.float32) / 255
    a = a + halo * 0.35
    # aberración cromática muy leve hacia los bordes (rojo y azul se separan 1 px)
    a[:, :, 0] = np.roll(a[:, :, 0], 1, axis=1); a[:, :, 2] = np.roll(a[:, :, 2], -1, axis=1)
    # viñeta suave
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    a = a * (1 - 0.12 * np.clip(r - 0.55, 0, 1) ** 1.6)[..., None]
    # grano fino de sensor
    rng = np.random.default_rng(7)
    a = a + rng.normal(0, 0.005, (h, w, 1))
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    # nitidez de revelado
    im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    im.save(salida)
print('listo', salida)
