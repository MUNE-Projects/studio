"""
Genera trabajo/residencial-demo/tipologias/a/vivienda.json (y alternativas.json) a partir de las medidas tomadas sobre
docs/plano-original.png (2000 x 1413 px).

Las coordenadas en píxeles se obtuvieron analizando el color de los muros
del plano (relleno gris ~176) y sus líneas. La escala se calibró con la
escala gráfica (0-3 m => 63.4 px/m) y se verificó con la superficie de
terraza + porche medida (32.7 m2 frente a 32.71 m2 oficiales).

Sistema de coordenadas del JSON:
  - metros, x hacia el este, y hacia el norte
  - origen en la esquina exterior suroeste de la vivienda (px 799, 931)

Cada elemento lleva `origen`:
  plano     -> medido o leído directamente del plano
  usuario   -> confirmado por la propietaria del proyecto
  memoria   -> tomado de la memoria de calidades
  supuesto  -> valor por defecto razonable, pendiente de confirmar
"""

import json
from pathlib import Path

PX_M = 63.4
OX, OY = 799, 931


def mx(px):
    return round((px - OX) / PX_M, 3)


def my(py):
    return round((OY - py) / PX_M, 3)


def rect(x0, y0, x1, y1):
    """Rectángulo en px de imagen -> [xmin, ymin, xmax, ymax] en metros."""
    return [mx(x0), my(y1), mx(x1), my(y0)]


def poly(pts):
    return [[mx(x), my(y)] for x, y in pts]


# ---------------------------------------------------------------- muros
# tipo: envolvente (fachada / separación con zonas comunes), tabique, pilar
MUROS = [
    ("m-oeste", "envolvente", (799, 449, 815, 915)),
    ("m-norte-salon", "envolvente", (815, 449, 1031, 460)),
    ("m-oeste-recibidor", "envolvente", (1021, 402, 1031, 449)),
    ("m-lateral-armario-recibidor", "tabique", (1027, 460, 1031, 519)),
    ("m-fondo-armario-recibidor", "tabique", (1027, 519, 1069, 523)),
    ("m-norte-recibidor", "envolvente", (1031, 402, 1160, 412)),
    ("m-recibidor-homes", "tabique", (1160, 402, 1173, 583)),
    ("m-oeste-homes", "envolvente", (1169, 371, 1173, 402)),
    ("m-norte-homes-bano2", "envolvente", (1173, 371, 1386, 377)),
    ("m-homes-bano2", "tabique", (1266, 377, 1269, 518)),
    ("m-entre-banos", "envolvente", (1386, 371, 1420, 523)),
    ("m-oeste-bano-principal", "envolvente", (1416, 327, 1420, 371)),
    ("m-norte-bano-principal", "envolvente", (1420, 327, 1544, 333)),
    ("m-este-norte", "envolvente", (1537, 333, 1544, 739)),
    ("m-este-quiebro", "envolvente", (1537, 739, 1614, 744)),
    ("m-este-sur", "envolvente", (1604, 744, 1614, 915)),
    ("m-sur-humedos-a", "tabique", (1173, 518, 1386, 523)),
    ("m-sur-humedos-b", "tabique", (1420, 518, 1537, 523)),
    ("m-cocina-norte", "tabique", (1044, 583, 1160, 586)),
    ("m-distribuidor-cocina", "tabique", (1173, 583, 1193, 586)),
    ("m-dormitorio2-norte", "tabique", (1323, 583, 1386, 586)),
    ("m-armarios-dormitorio2", "tabique", (1193, 621, 1323, 624)),
    ("m-armario-dormitorio2-lateral", "tabique", (1323, 586, 1326, 662)),
    ("m-salon-cocina", "tabique", (1044, 586, 1047, 915)),
    ("m-cocina-dormitorio2", "tabique", (1188, 586, 1193, 915)),
    ("m-dormitorios", "tabique", (1386, 523, 1389, 915)),
    ("m-fachada-sur", "envolvente", (799, 915, 1614, 931)),
    ("p-salon-cocina", "pilar", (1020, 631, 1044, 665)),
    ("p-fachada-salon", "pilar", (1016, 900, 1044, 915)),
    ("p-dormitorio-principal", "pilar", (1389, 796, 1409, 826)),
    ("p-fachada-dormitorio2", "pilar", (1366, 896, 1386, 915)),
    ("p-fachada-dormitorio-principal", "pilar", (1389, 896, 1400, 915)),
]

# ---------------------------------------------------------------- huecos
# eje: el hueco recorre el muro en x ("x") o en y ("y"); desde/hasta en px
# bisagra: "inicio" | "fin" (extremo del hueco, en el sentido del eje)
# abre: hacia qué lado gira la hoja: "n", "s", "e", "o"
HUECOS = [
    dict(id="h-entrada", muro="m-norte-recibidor", tipo="entrada", eje="x",
         desde=1094, hasta=1153, bisagra="fin", abre="s", origen="plano"),
    dict(id="h-recibidor-distribuidor", muro="m-recibidor-homes", tipo="puerta", eje="y",
         desde=527, hasta=579, bisagra="fin", abre="e", origen="usuario"),
    dict(id="h-espacio-homes", muro="m-sur-humedos-a", tipo="puerta", eje="x",
         desde=1208, hasta=1260, bisagra="fin", abre="n", origen="plano"),
    dict(id="h-bano2", muro="m-sur-humedos-a", tipo="puerta", eje="x",
         desde=1273, hasta=1325, bisagra="inicio", abre="n", origen="plano"),
    dict(id="h-bano-principal", muro="m-sur-humedos-b", tipo="puerta", eje="x",
         desde=1426, hasta=1478, bisagra="inicio", abre="n", origen="plano"),
    dict(id="h-cocina", muro="m-cocina-norte", tipo="puerta", eje="x",
         desde=1091, hasta=1143, bisagra="fin", abre="s", origen="plano"),
    dict(id="h-dormitorio2", muro="m-dormitorio2-norte", tipo="puerta", eje="x",
         desde=1331, hasta=1382, bisagra="fin", abre="s", origen="plano"),
    dict(id="h-dormitorio-principal", muro="m-dormitorios", tipo="puerta", eje="y",
         desde=527, hasta=579, bisagra="fin", abre="e", origen="plano"),
    dict(id="h-balconera-salon", muro="m-fachada-sur", tipo="balconera", eje="x",
         desde=886, hasta=1016, apertura="corredera", hojas=2, origen="supuesto"),
    dict(id="h-balconera-cocina", muro="m-fachada-sur", tipo="balconera", eje="x",
         desde=1050, hasta=1148, apertura="oscilobatiente", hojas=2, origen="memoria"),
    dict(id="h-balconera-dormitorio2", muro="m-fachada-sur", tipo="balconera", eje="x",
         desde=1243, hasta=1366, apertura="oscilobatiente", hojas=2, origen="memoria"),
    dict(id="h-balconera-dormitorio-principal", muro="m-fachada-sur", tipo="balconera", eje="x",
         desde=1400, hasta=1530, apertura="oscilobatiente", hojas=2, origen="memoria"),
]

# ---------------------------------------------------------------- estancias
ESTANCIAS = [
    dict(id="salon", nombre="Salón-comedor", superficie=24.77, uso="dia", suelo="madera",
         pts=[(815, 460), (1027, 460), (1027, 523), (1031, 523), (1031, 583), (1044, 583),
              (1044, 631), (1020, 631), (1020, 665), (1044, 665), (1044, 900), (1016, 900),
              (1016, 915), (815, 915)]),
    dict(id="recibidor", nombre="Recibidor", superficie=5.07, uso="circulacion", suelo="madera",
         pts=[(1031, 412), (1160, 412), (1160, 583), (1031, 583)]),
    dict(id="distribuidor", nombre="Distribuidor", superficie=4.31, uso="circulacion", suelo="madera",
         pts=[(1173, 523), (1386, 523), (1386, 583), (1323, 583), (1323, 621), (1193, 621),
              (1193, 583), (1173, 583)]),
    dict(id="espacio-homes", nombre="Espacio Homes", superficie=3.11, uso="servicio", suelo="ceramico",
         pts=[(1173, 377), (1266, 377), (1266, 518), (1173, 518)]),
    dict(id="bano2", nombre="Baño 2", superficie=3.96, uso="humedo", suelo="porcelanico-bano",
         pts=[(1269, 377), (1386, 377), (1386, 518), (1269, 518)]),
    dict(id="bano-principal", nombre="Baño principal", superficie=5.22, uso="humedo", suelo="porcelanico-bano",
         pts=[(1420, 333), (1537, 333), (1537, 518), (1420, 518)]),
    dict(id="cocina", nombre="Cocina", superficie=11.18, uso="dia", suelo="porcelanico-cocina",
         pts=[(1047, 586), (1188, 586), (1188, 915), (1047, 915)]),
    dict(id="dormitorio2", nombre="Dormitorio 2", superficie=13.98, uso="noche", suelo="madera",
         pts=[(1193, 624), (1326, 624), (1326, 586), (1386, 586), (1386, 896), (1366, 896),
              (1366, 915), (1193, 915)]),
    dict(id="dormitorio-principal", nombre="Dormitorio principal", superficie=16.58, uso="noche",
         suelo="madera",
         pts=[(1389, 523), (1537, 523), (1537, 744), (1604, 744), (1604, 915), (1400, 915),
              (1400, 896), (1389, 896), (1389, 826), (1409, 826), (1409, 796), (1389, 796)]),
    dict(id="terraza", nombre="Terraza", superficie=11.33, uso="exterior", suelo="exterior",
         pts=[(817, 932), (985, 932), (985, 1070), (1608, 1070), (1608, 1098), (817, 1098)]),
    dict(id="porche", nombre="Porche", superficie=21.38, uso="exterior", suelo="exterior",
         pts=[(985, 932), (1608, 932), (1608, 1070), (985, 1070)]),
]

# ---------------------------------------------------------------- equipamiento
# fijo=True: entregado con la vivienda según la memoria (arquitectura)
# fijo=False: mobiliario ilustrativo dibujado en el plano
# frente: hacia dónde mira el elemento (n, s, e, o)
EQUIPAMIENTO = [
    # armarios empotrados (memoria: lacado blanco)
    dict(id="armario-recibidor", tipo="armario", px=(1031, 412, 1069, 519), frente="e", fijo=True, origen="plano"),
    dict(id="armario-distribuidor", tipo="armario", px=(1193, 586, 1323, 621), frente="n", fijo=True, origen="plano"),
    dict(id="armario-dormitorio2", tipo="armario", px=(1193, 624, 1323, 662), frente="s", fijo=True, origen="plano"),
    dict(id="armario-dormitorio-principal", tipo="armario", px=(1498, 525, 1537, 688), frente="o", fijo=True, origen="plano"),
    # cocina (memoria)
    dict(id="cocina-frigorifico", tipo="columna-frigorifico", px=(1148, 590, 1188, 627), frente="o", fijo=True, origen="plano"),
    dict(id="cocina-hornos", tipo="columna-hornos", px=(1148, 627, 1188, 665), frente="o", fijo=True, origen="plano"),
    dict(id="cocina-encimera", tipo="encimera", px=(1148, 665, 1188, 858), frente="o", fijo=True, origen="plano",
         placa=(700, 748), fregadero=(775, 822), lavavajillas=(822, 858)),
    # baños (memoria + plano; doble lavabo confirmado por la usuaria)
    dict(id="bano2-banera", tipo="banera", px=(1273, 380, 1383, 420), frente="s", fijo=True, origen="plano"),
    dict(id="bano2-inodoro", tipo="inodoro", px=(1345, 432, 1383, 462), frente="o", fijo=True, origen="plano"),
    dict(id="bano2-lavabo", tipo="lavabo", px=(1355, 475, 1383, 512), frente="o", fijo=True, origen="plano"),
    dict(id="banop-ducha", tipo="ducha", px=(1420, 333, 1537, 380), frente="s", fijo=True, origen="plano"),
    dict(id="banop-inodoro", tipo="inodoro", px=(1500, 398, 1534, 425), frente="o", fijo=True, origen="plano"),
    dict(id="banop-lavabo", tipo="lavabo-doble", px=(1505, 437, 1534, 510), frente="o", fijo=True, origen="usuario"),
    dict(id="homes-lavadora", tipo="lavadora", px=(1225, 381, 1263, 420), frente="s", fijo=True, origen="memoria"),
    # mobiliario ilustrativo (plano)
    dict(id="salon-mesa", tipo="mesa-comedor", px=(890, 468, 948, 550), frente="s", fijo=False, origen="plano"),
    dict(id="salon-silla-1", tipo="silla", px=(866, 474, 894, 504), frente="e", fijo=False, origen="plano"),
    dict(id="salon-silla-2", tipo="silla", px=(866, 514, 894, 544), frente="e", fijo=False, origen="plano"),
    dict(id="salon-silla-3", tipo="silla", px=(944, 474, 972, 504), frente="o", fijo=False, origen="plano"),
    dict(id="salon-silla-4", tipo="silla", px=(944, 514, 972, 544), frente="o", fijo=False, origen="plano"),
    dict(id="salon-sofa-norte", tipo="sofa", px=(862, 657, 969, 713), frente="s", fijo=False, origen="plano"),
    dict(id="salon-sofa-oeste", tipo="sofa", px=(820, 720, 877, 862), frente="e", fijo=False, origen="plano"),
    dict(id="salon-mesa-centro", tipo="mesa-centro", px=(902, 763, 960, 820), frente="s", fijo=False, origen="plano"),
    dict(id="salon-mesa-auxiliar", tipo="mesa-auxiliar", px=(890, 852, 921, 884), frente="s", fijo=False, origen="plano"),
    dict(id="salon-mueble-tv", tipo="mueble-tv", px=(1020, 668, 1044, 898), frente="o", fijo=False, origen="usuario"),
    dict(id="dorm2-cama-1", tipo="cama", px=(1197, 718, 1318, 775), frente="e", fijo=False, origen="plano"),
    dict(id="dorm2-cama-2", tipo="cama", px=(1197, 807, 1318, 864), frente="e", fijo=False, origen="plano"),
    dict(id="dorm2-mesilla", tipo="mesilla", px=(1197, 778, 1222, 804), frente="e", fijo=False, origen="plano"),
    dict(id="dormp-cama", tipo="cama", px=(1473, 782, 1600, 878), frente="o", fijo=False, origen="plano"),
    dict(id="dormp-mesilla-1", tipo="mesilla", px=(1575, 752, 1600, 778), frente="o", fijo=False, origen="plano"),
    dict(id="dormp-mesilla-2", tipo="mesilla", px=(1575, 880, 1600, 906), frente="o", fijo=False, origen="plano"),
]

# ---------------------------------------------------------------- exterior
BARANDILLA = dict(
    origen="plano + usuario",
    # recorrido (px) por el borde de terraza + porche
    recorrido=[(810, 932), (810, 1104), (1611, 1104), (1611, 932)],
    postes_x=[880, 962, 1043, 1124, 1205, 1286, 1367, 1448, 1529],
)


# ---------------------------------------------------------------- alternativas de distribución
# Cada alternativa es un parche sobre la vivienda base: solo describe lo que cambia.
# Lo que no aparece aquí se conserva exactamente igual.
ALTERNATIVAS = [
    dict(
        id="cocina-abierta",
        nombre="Cocina abierta al salón",
        descripcion="Se abre un paso de 2,0 m en el tabique entre salón y cocina, junto a la fachada. "
                    "La cocina conserva su puerta al recibidor.",
        muros=dict(modificar={
            # el tabique salón-cocina se acorta: se conserva el tramo norte (desde el pilar)
            "m-salon-cocina": dict(px=(1044, 586, 1047, 788)),
        }),
        estancias=dict(modificar={
            # el salón gana la franja que ocupaba el tabique retirado
            "salon": dict(nombre="Salón-comedor", pts=[
                (815, 460), (1027, 460), (1027, 523), (1031, 523), (1031, 583), (1044, 583),
                (1044, 631), (1020, 631), (1020, 665), (1044, 665), (1044, 788), (1047, 788),
                (1047, 915), (1044, 915), (1044, 900), (1016, 900), (1016, 915), (815, 915)]),
            "cocina": dict(nombre="Cocina abierta"),
        }),
        # vista que explica el cambio: desde el salón hacia la cocina, a través del paso
        vista=dict(nombre="Salón hacia cocina", pos=[0.9, 1.5, -3.7], obj=[5.3, 0.95, -1.15], fov=62, interior=True),
        resumen="El salón y la cocina quedan comunicados por un paso de 2,0 m junto a la fachada.",
    ),
]


def alternativa_json(v):
    out = {"id": v["id"], "nombre": v["nombre"], "descripcion": v["descripcion"], "resumen": v.get("resumen", ""),
           "vista": v.get("vista"), "origen": "propuesta (prueba de configurador)"}
    muros = v.get("muros", {})
    out["muros"] = {
        "quitar": muros.get("quitar", []),
        "anadir": [{"id": i, "tipo": t, "rect": rect(*r), "origen": "alternativa"} for i, t, r in muros.get("anadir", [])],
        "modificar": {k: {"rect": rect(*d["px"])} for k, d in muros.get("modificar", {}).items()},
    }
    est = v.get("estancias", {})
    out["estancias"] = {"modificar": {}}
    for k, d in est.get("modificar", {}).items():
        m = {kk: vv for kk, vv in d.items() if kk != "pts"}
        if "pts" in d:
            m["poligono"] = poly(d["pts"])
        out["estancias"]["modificar"][k] = m
    out["huecos"] = v.get("huecos", {"quitar": [], "anadir": [], "modificar": {}})
    out["equipamiento"] = v.get("equipamiento", {"quitar": [], "anadir": [], "modificar": {}})
    return out


def main():
    out = {
        "meta": {
            "nombre": "Caso de prueba — vivienda en planta baja, 3 dormitorios",
            "fuente": "Plano comercial V.00 (marzo 2026) + memoria de calidades",
            "escala_px_m": PX_M,
            "origen_px": [OX, OY],
            "sistema": "metros; x = este, y = norte; origen en esquina exterior SO",
            "tolerancia_m": 0.1,
            "superficies_oficiales": {"interior": 88.18, "exterior": 32.71, "construida": 123.21},
        },
        "alturas": {
            "libre": {"valor": 2.5, "origen": "supuesto"},
            "forjado": {"valor": 0.3, "origen": "supuesto"},
            "puerta_interior": {"valor": 2.03, "origen": "supuesto"},
            "puerta_entrada": {"valor": 2.1, "origen": "supuesto"},
            "balconera": {"valor": 2.2, "origen": "supuesto"},
            "barandilla": {"valor": 1.05, "origen": "supuesto"},
        },
        "muros": [
            {"id": i, "tipo": t, "rect": rect(*r), "origen": "plano"} for i, t, r in MUROS
        ],
        "huecos": [],
        "estancias": [
            {k: v for k, v in e.items() if k != "pts"} | {"poligono": poly(e["pts"]), "origen": "plano"}
            for e in ESTANCIAS
        ],
        "equipamiento": [],
        "exterior": {
            "barandilla": {
                "origen": BARANDILLA["origen"],
                "recorrido": poly(BARANDILLA["recorrido"]),
                "postes_x": [mx(x) for x in BARANDILLA["postes_x"]],
                "tipo": {"valor": "vidrio con perfilería oscura", "origen": "supuesto"},
            },
            "porche_cubierto": {"valor": True, "origen": "plano (línea discontinua de proyección)"},
        },
        "acabados": {
            "carpinteria_exterior": {"valor": "aluminio lacado RPT, gris antracita", "origen": "memoria (color: supuesto)"},
            "puertas_interiores": {"valor": "lacado blanco pantografiado, herrajes cromo mate", "origen": "memoria"},
            "armarios": {"valor": "lacado blanco", "origen": "memoria"},
            "paredes": {"valor": "pintura lisa blanco roto", "origen": "memoria (tono: supuesto)"},
            "techos": {"valor": "falso techo continuo, pintura clara", "origen": "memoria"},
            "suelo_general": {"valor": "tarima de roble natural en salón, recibidor, distribuidor y dormitorios", "origen": "usuario (opciones comerciales; la memoria indica gres porcelánico)"},
            "suelo_cocina_banos": {"valor": "gres porcelánico", "origen": "memoria"},
            "suelo_espacio_homes": {"valor": "cerámico", "origen": "memoria"},
            "suelo_terraza": {"valor": "porcelánico antideslizante", "origen": "memoria"},
            "alicatado_banos": {"valor": "gres cerámico claro", "origen": "memoria (tono: supuesto)"},
            "cocina": {"valor": "muebles laminados blancos, encimera y frontal de cuarzo oscuro", "origen": "memoria (tonos: supuesto)"},
            "fachada": {"valor": "SATE blanco", "origen": "memoria (tono: supuesto)"},
        },
    }

    for h in HUECOS:
        d = dict(h)
        d["desde"] = mx(h["desde"]) if h["eje"] == "x" else my(h["hasta"])
        d["hasta"] = mx(h["hasta"]) if h["eje"] == "x" else my(h["desde"])
        if h["eje"] == "y":
            # al invertir el eje vertical, la bisagra cambia de extremo
            if "bisagra" in d:
                d["bisagra"] = {"inicio": "fin", "fin": "inicio"}[d["bisagra"]]
        out["huecos"].append(d)

    for e in EQUIPAMIENTO:
        d = {k: v for k, v in e.items() if k not in ("px", "placa", "fregadero", "lavavajillas")}
        d["rect"] = rect(*e["px"])
        for k in ("placa", "fregadero", "lavavajillas"):
            if k in e:
                a, b = e[k]
                d[k] = [my(b), my(a)]
        out["equipamiento"].append(d)

    dst = Path(__file__).resolve().parent.parent / "trabajo" / "residencial-demo" / "tipologias" / "a" / "vivienda.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2))

    dst_var = dst.parent / "alternativas.json"
    dst_var.write_text(json.dumps([alternativa_json(v) for v in ALTERNATIVAS], ensure_ascii=False, indent=2))
    print("->", dst_var)

    # comprobación de superficies
    def area(p):
        return abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))) / 2

    print(f"{'estancia':24} {'medida':>8} {'oficial':>8} {'dif':>6}")
    for e in out["estancias"]:
        a = area(e["poligono"])
        print(f"{e['nombre']:24} {a:8.2f} {e['superficie']:8.2f} {100 * (a / e['superficie'] - 1):+5.1f}%")
    print("->", dst)


if __name__ == "__main__":
    main()
