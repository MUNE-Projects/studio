#!/usr/bin/env python3
"""Pasada de IA gratuita: convierte el render foto en una imagen fotográfica
SIN mover nada de sitio (decisión 70).

  python herramientas/foto_ia.py <render.png> <profundidad.png> <salida.png> [--fuerza 0.35] [--pasos 30] [--ancho 768]

Usa modelos abiertos de Hugging Face, que permiten el uso comercial y no piden
citar a nadie en las imágenes:
  · Realistic Vision V6 (SG161222, licencia CreativeML OpenRAIL-M): fotografía realista;
  · ControlNet de profundidad (lllyasviel, OpenRAIL): obliga a respetar la forma
    exacta de la estancia (paredes, muebles, huecos), leída del mapa de
    profundidad que saca render_foto.py (--profundidad);
  · VAE ft-mse (Stability AI, MIT): colores más fieles.
Parte del render (img2img): `--fuerza` es cuánto puede cambiar (0 = nada,
1 = todo); con 0,6 pone luz, sombras y tejidos de foto; la forma la fijan la
profundidad y los contornos, y los colores de cada acabado se recuperan al final.
A 1024 px de ancho: más pequeño, la IA convierte los detalles finos (tiradores) en otra cosa.
Funciona sin tarjeta gráfica (más lento). Nada sale de este ordenador.
"""
import os, sys, time
import torch
from PIL import Image
from diffusers import AutoencoderKL, ControlNetModel, DPMSolverMultistepScheduler, StableDiffusionControlNetImg2ImgPipeline

def arg(nombre, defecto):
    return type(defecto)(sys.argv[sys.argv.index(nombre) + 1]) if nombre in sys.argv else defecto

render, profundidad, salida = sys.argv[1:4]
fuerza, pasos, ancho = arg('--fuerza', 0.62), arg('--pasos', 30), arg('--ancho', 1024)
semilla = arg('--semilla', 7)

# lo que hay en la foto con su acabado: --escena, o la descripción que deja render_foto.py
ruta_e = profundidad.replace('.png', '-escena.txt')
ESCENA = arg('--escena', open(ruta_e).read().strip() if os.path.exists(ruta_e) else 'modern apartment interior')
# la calidad va primero: la IA solo lee las primeras 77 «palabras» (tokens)
PROMPT = (f'RAW photo, professional interior photography, photorealistic, warm natural daylight, soft shadows, '
          f'full frame camera, 24mm lens, sharp focus, high detail, {ESCENA}')
# lo que la IA tiende a inventarse y no puede añadir ni cambiar
NEGATIVO = ('cgi, 3d render, cartoon, illustration, blurry, soft, plastic, deformed, '
            'tufted, buttons, wood grain on doors, light switch, power outlet, extra objects, extra furniture, '
            'people, text, watermark, faded edges')
print('escena:', ESCENA)

t0 = time.time()
torch.set_num_threads(os.cpu_count() or 4)
# por defecto, solo la profundidad (como la primera prueba): la guía de contornos fija mejor los
# detalles, pero la IA dibuja sus líneas como dientes o pespuntes en los bordes rectos
c_cont = arg('--control-contornos', 0.0)
red = [ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32, use_safetensors=True)]
if c_cont > 0:
    red.append(ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_canny', variant='fp16', torch_dtype=torch.float32, use_safetensors=True))
vae = AutoencoderKL.from_pretrained('stabilityai/sd-vae-ft-mse', torch_dtype=torch.float32, use_safetensors=True)
# Realistic Vision se publica como un único archivo .safetensors (sin código ejecutable dentro)
from huggingface_hub import hf_hub_download
pesos = hf_hub_download('SG161222/Realistic_Vision_V6.0_B1_noVAE', 'Realistic_Vision_V6.0_NV_B1_fp16.safetensors')
tubo = StableDiffusionControlNetImg2ImgPipeline.from_single_file(
    pesos, config='stable-diffusion-v1-5/stable-diffusion-v1-5', controlnet=red, vae=vae, torch_dtype=torch.float32,
    safety_checker=None, requires_safety_checker=False)
tubo.scheduler = DPMSolverMultistepScheduler.from_config(tubo.scheduler.config, use_karras_sigmas=True)
print('modelos listos en %.0f s' % (time.time() - t0))

original = Image.open(render).convert('RGB')
W = ancho // 8 * 8
H = round(original.height * W / original.width) // 8 * 8
img = original.resize((W, H), Image.LANCZOS)
prof = Image.open(profundidad).convert('RGB').resize((W, H), Image.LANCZOS)
import cv2, numpy as np
gris = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2GRAY)
bordes = cv2.Canny(cv2.GaussianBlur(gris, (3, 3), 0), arg('--canny-bajo', 40), arg('--canny-alto', 120))
# + los bordes exactos entre materiales (mapa del render): la alfombra o el cabecero
# no se disuelven aunque apenas contrasten
ruta_m = profundidad.replace('.png', '-materiales.png')
if os.path.exists(ruta_m):
    mt = np.asarray(Image.open(ruta_m).convert('RGB').resize((W, H), Image.NEAREST)).astype(np.int32)
    clave = mt[..., 0] * 65536 + mt[..., 1] * 256 + mt[..., 2]
    borde_m = np.zeros_like(clave, dtype=bool)
    borde_m[:, 1:] |= clave[:, 1:] != clave[:, :-1]
    borde_m[1:, :] |= clave[1:, :] != clave[:-1, :]
    bordes = np.maximum(bordes, borde_m.astype(np.uint8) * 255)
contornos = Image.fromarray(np.stack([bordes] * 3, -1))

crudo = salida.replace('.png', '-crudo.png')
t1 = time.time()
if '--reusar' in sys.argv and os.path.exists(crudo):
    resultado = Image.open(crudo).convert('RGB'); pasos_detalle = 0
else:
  resultado = tubo(prompt=PROMPT, negative_prompt=NEGATIVO, image=img, control_image=[prof, contornos][:len(red)],
                 strength=fuerza, num_inference_steps=pasos, guidance_scale=arg('--guia', 5.0),
                 controlnet_conditioning_scale=[arg('--control', 1.0), c_cont][:len(red)],
                 # los contornos solo al principio: fijan la forma, y el detalle final lo pone la IA libre
                 control_guidance_start=[0.0, 0.0][:len(red)], control_guidance_end=[1.0, arg('--fin-contornos', 1.0)][:len(red)],
                 generator=torch.Generator().manual_seed(semilla)).images[0]
  pasos_detalle = arg('--detalle', 0.0)
print('imagen en %.0f s' % (time.time() - t1))
# segunda pasada, suave y a tamaño completo: recupera la nitidez sin cambiar nada
if pasos_detalle > 0:
    W2 = min(original.width, arg('--ancho-detalle', 1400)) // 8 * 8
    H2 = round(original.height * W2 / original.width) // 8 * 8
    ctrl2 = [prof.resize((W2, H2), Image.LANCZOS), contornos.resize((W2, H2), Image.NEAREST)]
    t2 = time.time()
    resultado = tubo(prompt=PROMPT, negative_prompt=NEGATIVO, image=resultado.resize((W2, H2), Image.LANCZOS), control_image=ctrl2[:len(red)],
                     strength=pasos_detalle, num_inference_steps=pasos, guidance_scale=arg('--guia', 5.5),
                     controlnet_conditioning_scale=[0.8, 0.8][:len(red)], generator=torch.Generator().manual_seed(semilla + 1)).images[0]
    print('detalle en %.0f s' % (time.time() - t2))
if not ('--reusar' in sys.argv and os.path.exists(crudo)): resultado.save(crudo)

# ---- fidelidad a los acabados (decisión 70): la IA aporta textura, luz y detalle;
# los colores y lo protegido siguen siendo los del render
import numpy as np
from PIL import ImageFilter
ia = resultado.resize(original.size, Image.LANCZOS)
o = np.asarray(original).astype(np.float32); a = np.asarray(ia).astype(np.float32)
def ycc(x):
    y = x @ np.array([0.299, 0.587, 0.114]); return y, x - y[..., None]
yo, co = ycc(o); ya, ca = ycc(a)
# 1) color por material: cada acabado (mapa del render) recupera su color medio y su
#    claridad media, pero conserva la luz, las sombras y la textura que pone la IA dentro de él
#    (corregir píxel a píxel volvía a dar aspecto de render)
k, kl = arg('--color', 1.0), arg('--claridad', 0.0)
mezcla = a.copy()
if os.path.exists(ruta_m):
    mt = np.asarray(Image.open(ruta_m).convert('RGB').resize(original.size, Image.NEAREST)).astype(np.int32)
    clave = mt[..., 0] * 65536 + mt[..., 1] * 256 + mt[..., 2]
    dC = np.zeros_like(a); dY = np.zeros(a.shape[:2], np.float32)
    rp = profundidad.replace('.png', '-proteger.png')
    prot = np.asarray(Image.open(rp).convert('L').resize(original.size, Image.NEAREST)).astype(int) if os.path.exists(rp) else np.zeros(clave.shape, int)
    # pieza a pieza (cada trozo suelto de cada material): dos cojines iguales en dos sofás
    # se corrigen cada uno con lo suyo
    trozos = []
    for kk in np.unique(clave):
        n, et = cv2.connectedComponents((clave == kk).astype(np.uint8), connectivity=8)
        trozos += [et == t for t in range(1, n)]
    for sel in trozos:
        if sel.sum() < 200: continue
        # el centro de la zona: la IA puede haber movido el borde unos píxeles
        nucleo = np.asarray(Image.fromarray((sel * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7))) > 0
        z = nucleo if nucleo.sum() > 100 else sel
        dC[sel] = (np.median(co[z], 0) - np.median(ca[z], 0)) * k
        # los tejidos también recuperan su claridad a medias: la IA los deslava (cojines)
        kz = max(kl, arg('--claridad-tela', 0.5)) if abs(np.median(prot[z]) - 140) <= 1 else kl
        dY[sel] = (np.median(yo[z]) - np.median(ya[z])) * kz
    dC = cv2.GaussianBlur(dC, (0, 0), 3); dY = cv2.GaussianBlur(dY, (0, 0), 3)
    mezcla = ya[..., None] + dY[..., None] + ca + dC
# 1b) nada inventado: donde la IA dibuja líneas que el render no tiene (una barra en un armario
#     liso, letras en un cojín…) se queda su luz (lo borroso) y se quita su dibujo
if '--quitar-inventos' in sys.argv:  # en pruebas
    def lineas(x, bajo, alto):
        g = cv2.GaussianBlur(np.clip(x, 0, 255).astype(np.uint8), (3, 3), 0)
        return cv2.Canny(cv2.cvtColor(g, cv2.COLOR_RGB2GRAY), bajo, alto) > 0
    del_render = cv2.dilate(lineas(o, 15, 45).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    inv = (lineas(mezcla, 50, 140) & ~del_render).astype(np.uint8)
    inv = cv2.GaussianBlur(cv2.dilate(inv, np.ones((11, 11), np.uint8)).astype(np.float32), (0, 0), 4)[..., None]
    inv = np.clip(inv * 2, 0, 1)
    liso = cv2.GaussianBlur(mezcla, (0, 0), 6) + (o - cv2.GaussianBlur(o, (0, 0), 6))
    mezcla = mezcla * (1 - inv) + liso * inv
    if '--ver-inventos' in sys.argv:
        Image.fromarray((inv[..., 0] * 255).astype(np.uint8)).save(salida.replace('.png', '-inventos.png'))
# 2) zonas protegidas (máscara del render): vuelven al render en esa proporción
ruta_p = profundidad.replace('.png', '-proteger.png')
if os.path.exists(ruta_p) and '--sin-proteger' not in sys.argv:
    pr = np.asarray(Image.open(ruta_p).convert('L').resize(original.size, Image.NEAREST)).astype(int)
    def borde_suave(sel, ancho, difuminado):
        x = cv2.dilate(sel.astype(np.uint8), np.ones((ancho, ancho), np.uint8)) if ancho > 1 else sel.astype(np.uint8)
        return np.clip(cv2.GaussianBlur(x.astype(np.float32), (0, 0), difuminado), 0, 1)[..., None]
    Ya = mezcla @ np.array([0.299, 0.587, 0.114])
    # a) los cuadros, con su marco y un margen de pared: la IA dibuja su propio marco (oscuro,
    #    a veces doble) y sus líneas quedaban alrededor como una sombra. Vuelve el render
    #    entero en esa zona, con la luz media de la IA (si no, se nota el parche)
    cuadro = pr > 240
    if cuadro.any():
        zona = borde_suave(cuadro, 45, 6)
        banda = (borde_suave(cuadro, 75, 0.1)[..., 0] > 0.5) & (zona[..., 0] < 0.5)
        gan = np.median(mezcla[banda], 0) / np.maximum(np.median(o[banda], 0), 1) if banda.any() else 1
        mezcla = mezcla * (1 - zona) + (o * gan) * zona
    # b) lo que se ve por las ventanas (el entorno real: la IA se inventa mar o ciudad)
    vidrio = abs(pr - round(255 * 0.62)) <= 1
    # c) las piezas pequeñas (tiradores, interruptores…): la IA las convierte en otra cosa
    piezas = np.zeros(pr.shape, bool)
    if os.path.exists(ruta_m) and '--sin-piezas' not in sys.argv:
        # cada trozo suelto de cada material: los pequeños son piezas (un tirador comparte
        # material con otros, pero es un trozo aparte); no los textiles (cojines)
        for kk in np.unique(clave):
            n, etiquetas, stats, _ = cv2.connectedComponentsWithStats((clave == kk).astype(np.uint8), connectivity=8)
            peq = np.where(stats[1:, cv2.CC_STAT_AREA] < clave.size * arg('--pieza', 0.004))[0] + 1
            if len(peq): piezas |= np.isin(etiquetas, peq)
        piezas &= ~np.isin(pr, [round(255 * 0.55)])
    # más margen en las piezas: lo que la IA pone en su lugar (un interruptor) suele ser más ancho
    m = np.maximum(borde_suave(vidrio, 9, 3), borde_suave(piezas, 21, 4))
    # con la luz de lo que hay alrededor en la foto de la IA: si no, se ven cuadrados (más
    # oscuros o más claros) alrededor de los focos del techo, las velas…
    yo_ = o @ np.array([0.299, 0.587, 0.114])
    fuera = (1 - np.clip(cv2.dilate((m[..., 0] > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)), 0, 1)).astype(np.float32)
    bl = lambda x: cv2.GaussianBlur(x.astype(np.float32), (0, 0), 18)
    luz = (bl(Ya * fuera) + 1) / (bl(yo_ * fuera) + 1)
    mezcla = mezcla * (1 - m) + (o * np.clip(luz, 0.5, 2.0)[..., None]) * m
    # d) las alfombras (la IA las funde con el suelo) y los modelos con texturas reales de la
    #    biblioteca (la mesa de hormigón salía de madera): su color y su tejido son los del
    #    render; la luz (sombras, sol), la de la IA
    alfombra = abs(pr - round(255 * 0.7)) <= 1
    # …y los cojines (trozos pequeños de tela): la IA los aplasta contra el respaldo
    if os.path.exists(ruta_m) and '--sin-cojines' not in sys.argv:
        tela = np.isin(pr, [round(255 * 0.55)])
        for kk in np.unique(clave[tela]):
            n, et, st, _ = cv2.connectedComponentsWithStats((tela & (clave == kk)).astype(np.uint8), connectivity=4)
            peq = np.where((st[1:, cv2.CC_STAT_AREA] > 300) & (st[1:, cv2.CC_STAT_AREA] < clave.size * arg('--cojin', 0.02)))[0] + 1
            if len(peq): alfombra |= np.isin(et, peq)
    if alfombra.any():
        g = cv2.GaussianBlur(Ya.astype(np.float32), (0, 0), 10) / np.maximum(cv2.GaussianBlur(yo_.astype(np.float32), (0, 0), 10), 1)
        za = cv2.GaussianBlur(cv2.erode(alfombra.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 1.5)[..., None]
        mezcla = mezcla * (1 - za) + (o * np.clip(g, 0.6, 1.6)[..., None]) * za
Image.fromarray(np.clip(mezcla, 0, 255).astype(np.uint8)).save(salida)
print('listo', salida)
