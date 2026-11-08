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
1 = todo); con 0,3–0,4 cambia la textura y la luz, no los acabados.
Funciona sin tarjeta gráfica (más lento). Nada sale de este ordenador.
"""
import os, sys, time
import torch
from PIL import Image
from diffusers import AutoencoderKL, ControlNetModel, DPMSolverMultistepScheduler, StableDiffusionControlNetImg2ImgPipeline

def arg(nombre, defecto):
    return type(defecto)(sys.argv[sys.argv.index(nombre) + 1]) if nombre in sys.argv else defecto

render, profundidad, salida = sys.argv[1:4]
fuerza, pasos, ancho = arg('--fuerza', 0.35), arg('--pasos', 30), arg('--ancho', 768)
semilla = arg('--semilla', 7)

# lo que hay en la foto con su acabado: --escena, o la descripción que deja render_foto.py
ruta_e = profundidad.replace('.png', '-escena.txt')
ESCENA = arg('--escena', open(ruta_e).read().strip() if os.path.exists(ruta_e) else 'modern apartment interior')
# la calidad va primero: la IA solo lee las primeras 77 «palabras» (tokens)
PROMPT = f'RAW photo, professional interior photography, photorealistic, sharp focus, high detail, natural light, {ESCENA}'
# lo que la IA tiende a inventarse y no puede añadir ni cambiar
NEGATIVO = ('cgi, 3d render, cartoon, illustration, blurry, soft, plastic, deformed, '
            'tufted, buttons, wood grain on doors, light switch, power outlet, extra objects, extra furniture, '
            'people, text, watermark, faded edges')
print('escena:', ESCENA)

t0 = time.time()
torch.set_num_threads(os.cpu_count() or 4)
red = [ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32, use_safetensors=True),
       # contornos del render: cada línea que hay sigue ahí, y donde no hay líneas no se inventan dibujos
       ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_canny', variant='fp16', torch_dtype=torch.float32, use_safetensors=True)]
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

t1 = time.time()
resultado = tubo(prompt=PROMPT, negative_prompt=NEGATIVO, image=img, control_image=[prof, contornos],
                 strength=fuerza, num_inference_steps=pasos, guidance_scale=arg('--guia', 5.5),
                 controlnet_conditioning_scale=[arg('--control', 1.0), arg('--control-contornos', 0.9)],
                 generator=torch.Generator().manual_seed(semilla)).images[0]
print('imagen en %.0f s' % (time.time() - t1))
# segunda pasada, suave y a tamaño completo: recupera la nitidez sin cambiar nada
if arg('--detalle', 0.22) > 0:
    W2 = min(original.width, arg('--ancho-detalle', 1400)) // 8 * 8
    H2 = round(original.height * W2 / original.width) // 8 * 8
    ctrl2 = [prof.resize((W2, H2), Image.LANCZOS), contornos.resize((W2, H2), Image.NEAREST)]
    t2 = time.time()
    resultado = tubo(prompt=PROMPT, negative_prompt=NEGATIVO, image=resultado.resize((W2, H2), Image.LANCZOS), control_image=ctrl2,
                     strength=arg('--detalle', 0.22), num_inference_steps=pasos, guidance_scale=arg('--guia', 5.5),
                     controlnet_conditioning_scale=[0.8, 0.8], generator=torch.Generator().manual_seed(semilla + 1)).images[0]
    print('detalle en %.0f s' % (time.time() - t2))

# ---- fidelidad a los acabados (decisión 70): la IA aporta textura, luz y detalle;
# los colores y lo protegido siguen siendo los del render
import numpy as np
from PIL import ImageFilter
ia = resultado.resize(original.size, Image.LANCZOS)
o = np.asarray(original).astype(np.float32); a = np.asarray(ia).astype(np.float32)
def ycc(x):
    y = x @ np.array([0.299, 0.587, 0.114]); return y, x - y[..., None]
yo, co = ycc(o); ya, ca = ycc(a)
# 1) color: la claridad (luz, textura) de la IA y, sobre todo, el color del render
k = arg('--color', 0.88)
mezcla = ya[..., None] + co * k + ca * (1 - k)
# 2) zonas protegidas (máscara del render): vuelven al render en esa proporción
ruta_p = profundidad.replace('.png', '-proteger.png')
if os.path.exists(ruta_p) and '--sin-proteger' not in sys.argv:
    # un poco más ancha que el objeto (la IA puede moverlo unos píxeles) y con el borde suave
    # solo lo protegido del todo (cuadros: son contenido, no textura); lo demás lo retoca la IA
    m = np.asarray(Image.open(ruta_p).convert('L').point(lambda v: 255 if v > 240 else 0).resize(original.size, Image.LANCZOS).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(4))).astype(np.float32)[..., None] / 255
    mezcla = mezcla * (1 - m) + o * m
Image.fromarray(np.clip(mezcla, 0, 255).astype(np.uint8)).save(salida)
print('listo', salida)
