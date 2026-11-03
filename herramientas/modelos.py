#!/usr/bin/env python3
"""Prepara un modelo 3D de Poly Haven (glTF 1k) para la biblioteca de MUNE.

  python3 herramientas/modelos.py <carpeta con el .gltf> <salida.glb> [--textura 512]

Lo junta en un solo archivo .glb y reduce sus texturas (por defecto a 512 px,
JPEG; las que tienen transparencia, PNG), para que la web pública cargue rápido.
La geometría no se toca. Los modelos de Poly Haven son CC0 (dominio público):
uso comercial y redistribución permitidos; se apuntan en biblioteca/licencias.md.
"""
import io, json, os, struct, sys
from PIL import Image

def main():
    carpeta, salida = sys.argv[1], sys.argv[2]
    lado = int(sys.argv[sys.argv.index('--textura') + 1]) if '--textura' in sys.argv else 512
    gltf_path = next(os.path.join(carpeta, f) for f in os.listdir(carpeta) if f.endswith('.gltf'))
    g = json.load(open(gltf_path))
    base = os.path.dirname(gltf_path)
    binario = bytearray()

    def anadir(datos):
        while len(binario) % 4: binario.append(0)
        ini = len(binario); binario.extend(datos)
        return ini

    # buffers originales -> un único buffer
    antiguos = [open(os.path.join(base, b['uri']), 'rb').read() for b in g['buffers']]
    desplaz = [anadir(b) for b in antiguos]
    for v in g.get('bufferViews', []):
        v['byteOffset'] = v.get('byteOffset', 0) + desplaz[v['buffer']]; v['buffer'] = 0
    # imágenes: reducidas e incrustadas
    for im in g.get('images', []):
        ruta = os.path.join(base, im.pop('uri'))
        img = Image.open(ruta)
        alfa = img.mode in ('RGBA', 'LA') and img.getchannel('A').getextrema()[0] < 250
        img = img.convert('RGBA' if alfa else 'RGB')
        if max(img.size) > lado: img = img.resize((lado, lado * img.size[1] // img.size[0]), Image.LANCZOS)
        out = io.BytesIO()
        if alfa: img.save(out, 'PNG', optimize=True); im['mimeType'] = 'image/png'
        else: img.save(out, 'JPEG', quality=82, optimize=True); im['mimeType'] = 'image/jpeg'
        g.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': anadir(out.getvalue()), 'byteLength': len(out.getvalue())})
        im['bufferView'] = len(g['bufferViews']) - 1
    while len(binario) % 4: binario.append(0)
    g['buffers'] = [{'byteLength': len(binario)}]
    js = json.dumps(g, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    with open(salida, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binario)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binario), 0x004E4942)); f.write(binario)
    print(f'{salida}: {os.path.getsize(salida) // 1024} KB')

main()
