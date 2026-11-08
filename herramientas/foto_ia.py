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

PROMPT = ('professional interior photography for a real estate brochure, photorealistic, natural daylight, '
          'soft shadows, realistic fabric and wood textures, sharp focus, shot on a full frame camera, 24mm lens, high detail')
NEGATIVO = ('cgi, 3d render, cartoon, illustration, painting, plastic, blurry, distorted, deformed, '
            'extra furniture, people, text, watermark, oversaturated')

t0 = time.time()
torch.set_num_threads(os.cpu_count() or 4)
red = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32, use_safetensors=True)
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

t1 = time.time()
resultado = tubo(prompt=PROMPT, negative_prompt=NEGATIVO, image=img, control_image=prof,
                 strength=fuerza, num_inference_steps=pasos, guidance_scale=5.0,
                 controlnet_conditioning_scale=arg('--control', 1.0),
                 generator=torch.Generator().manual_seed(semilla)).images[0]
print('imagen en %.0f s' % (time.time() - t1))

# ---- fidelidad a los acabados (decisión 70): la IA aporta textura, luz y detalle;
# los colores y lo protegido siguen siendo los del render
import numpy as np
from PIL import ImageFilter
ia = resultado.resize(original.size, Image.LANCZOS)
o = np.asarray(original).astype(np.float32); a = np.asarray(ia).astype(np.float32)
def ycc(x):
    y = x @ np.array([0.299, 0.587, 0.114]); return y, x - y[..., None]
yo, co = ycc(o); ya, ca = ycc(a)
# 1) color: la claridad (luz, textura) de la IA y el color del render
mezcla = ya[..., None] + co
# 2) zonas protegidas (máscara del render): vuelven al render en esa proporción
ruta_p = profundidad.replace('.png', '-proteger.png')
if os.path.exists(ruta_p) and '--sin-proteger' not in sys.argv:
    # un poco más ancha que el objeto (la IA puede moverlo unos píxeles) y con el borde suave
    m = np.asarray(Image.open(ruta_p).convert('L').resize(original.size, Image.LANCZOS).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(4))).astype(np.float32)[..., None] / 255
    mezcla = mezcla * (1 - m) + o * m
Image.fromarray(np.clip(mezcla, 0, 255).astype(np.uint8)).save(salida)
print('listo', salida)
