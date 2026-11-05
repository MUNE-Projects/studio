// Promotoras y promociones de MUNE Studio (receta 14 · Gestionar accesos).
//
// · Promotoras (#/promotoras): la lista y el alta (datos de la empresa y sus
//   administradores de la promotora, que reciben la invitación).
// · Una promotora (#/promotora/<id>): sus promociones, quién tiene acceso a
//   todas, sus datos y su actividad.
// · Una promoción (#/promocion/<id>/<pestaña>): resumen, validación y
//   versiones, equipo, documentación, ficha y datos (con los textos legales),
//   marca, compradores, peticiones de cambios y actividad.
//
// La promotora gestiona su propio equipo en MUNE Portal (Equipo); MUNE Studio
// lo ve todo y lo cambia solo como soporte (equipo.ts, función «invitar»,
// cambiar_acceso). Todo lo comprueban las reglas de la base de datos (005–020).

import { FASES, textoFase } from './fase';
import { datosFormalizacion, formFormalizacion, type Formalizacion } from './formalizacion';
import { pintarActividad } from './actividad';
import { alEnviar, anotar, conectarPlegables, cuantos, esc, fallo, fecha, sb, traducir } from './comun';
import { pintarDocumentacion } from './documentacion';
import { exportarPromocion, exportarPromotora, prepararExportacion, type Resultado } from './exportar';
import { pintarPeticiones } from './peticiones';
import { ESCAPARATE, REVISION, estadoVersiones, etiquetaVersiones, pintarVersiones } from './versiones';
import { pintarCompradores } from './compradores';
import { pintarPersonalizacion } from './personalizacion';
import { pintarCatalogo } from './catalogo';
import { pintarMarca } from './marca';
import { conectarSolicitar, formSolicitar } from './solicitar';
import { pintarEntorno } from './entorno';
import { pintarEstados } from './estado';
import { ADMIN_PROMOCION, ADMIN_PROMOTORA, TODAS_LAS_CAPACIDADES, conectarPersonas, formAcceso, insignias, invitar, leerAccesos, tablaPersonas } from './equipo';

interface DatosFiscales { razon_social: string | null; cif: string | null; domicilio_fiscal: string | null }
interface Promotora extends DatosFiscales { id: string; nombre: string; activa: boolean; contacto: string | null }
interface Ficha {
	direccion: string | null; codigo_postal: string | null; municipio: string | null; provincia: string | null;
	referencia_catastral: string | null; tipo: string | null; num_viviendas: number | null; num_portales: number | null;
	num_plantas: number | null; fecha_entrega: string | null; fase_proyecto?: string | null;
}
interface Promocion extends DatosFiscales, Ficha { id: string; nombre: string; ubicacion: string; estado: string; activa: boolean; promotora_id: string; formalizacion?: Formalizacion; textos_legales?: TextosLegales | null; modulos?: Modulos; publicacion?: string; solicitar_info?: string | null; solicitar_modo?: string | null; solicitar_formulario?: string | null }
interface Modulos { experiencia_publica: boolean; acceso_comprador: boolean; personalizacion: boolean }
interface TextosLegales { planos?: string; renders?: string; experiencia?: string; personalizacion?: string }

const CAMPOS_PROMOCION = `id, nombre, ubicacion, estado, activa, promotora_id, razon_social, cif, domicilio_fiscal,
	direccion, codigo_postal, municipio, provincia, referencia_catastral, tipo, num_viviendas, num_portales, num_plantas, fecha_entrega, fase_proyecto, formalizacion, textos_legales, modulos, publicacion, solicitar_info, solicitar_modo, solicitar_formulario`;

// ─── Partes de cada promoción y modo de publicación (022) ─────────────────

const MODULOS: [keyof Modulos, string, string][] = [
	['experiencia_publica', 'Experience pública', 'La promotora puede enseñar la Experiencia 3D en su web con direcciones públicas y códigos de inserción. Apagada, solo se ve en MUNE Portal y en los accesos privados.'],
	['acceso_comprador', 'Acceso comprador', 'Los compradores entran con su código a su vivienda. Apagado, no hay códigos ni puerta de comprador.'],
	['personalizacion', 'Personalización', 'Opciones y mejoras de la vivienda. Funciona aunque no haya acceso de comprador: el comercial puede enseñarla desde MUNE Portal.'],
];
const MODULOS_POR_DEFECTO: Modulos = { experiencia_publica: true, acceso_comprador: true, personalizacion: true };

/** Casillas de las partes de la promoción y el modo de publicación. */
function htmlModulos(m: Modulos = MODULOS_POR_DEFECTO, publicacion = 'automatica'): string {
	return `<fieldset class="capacidades modulos"><legend>Partes de la promoción</legend>
		${MODULOS.map(([k, t, ayuda]) => `<label class="casilla"><input type="checkbox" name="modulo" value="${k}" ${m[k] !== false ? 'checked' : ''}>
			<span><strong>${esc(t)}</strong><br><span class="promo-lugar">${esc(ayuda)}</span></span></label>`).join('')}
		<p class="ayuda">La Experiencia 3D profesional en MUNE Portal está siempre.</p>
	</fieldset>
	<fieldset class="capacidades modulos"><legend>Publicación</legend>
		<label class="casilla"><input type="radio" name="publicacion" value="automatica" ${publicacion !== 'manual' ? 'checked' : ''}>
			<span><strong>Publicar al aprobar la promotora</strong><br><span class="promo-lugar">Tu visto bueno es «Enviar a validar a la promotora». Cuando valida todo, se publica esa misma versión y te llega un email.</span></span></label>
		<label class="casilla"><input type="radio" name="publicacion" value="manual" ${publicacion === 'manual' ? 'checked' : ''}>
			<span><strong>Publico yo</strong><br><span class="promo-lugar">Con todo validado, publicas tú con el botón «Publicar».</span></span></label>
	</fieldset>`;
}

const leerModulos = (d: FormData): Modulos => {
	const marcados = new Set(d.getAll('modulo').map(String));
	return { experiencia_publica: marcados.has('experiencia_publica'), acceso_comprador: marcados.has('acceso_comprador'), personalizacion: marcados.has('personalizacion') };
};
const guardarModulos = (promocion: string, m: Modulos, publicacion: string) => sb.rpc('guardar_modulos', {
	p_promocion: promocion, p_experiencia_publica: m.experiencia_publica, p_acceso_comprador: m.acceso_comprador,
	p_personalizacion: m.personalizacion, p_publicacion: publicacion === 'manual' ? 'manual' : 'automatica',
});


const PESTANAS: [string, string][] = [
	['resumen', 'Resumen y versiones'],
	['equipo', 'Equipo'],
	['documentacion', 'Documentación'],
	['ficha', 'Ficha y datos'],
	['marca', 'Marca'],
	['compradores', 'Compradores'],
	['personalizacion', 'Personalización'],
	['peticiones', 'Peticiones de cambios'],
	['actividad', 'Actividad'],
];

// ── Utilidades ────────────────────────────────────────────────────────────

/** Identificador de promoción a partir de su nombre: «Residencial Las Eras» → residencial-las-eras. */
function identificador(nombre: string): string {
	return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function migas(partes: [string, string | null][]): string {
	return `<nav class="migas" aria-label="Dónde estás">${partes.map(([texto, href]) =>
		href ? `<a href="${esc(href)}">${esc(texto)}</a>` : `<span>${esc(texto)}</span>`).join(' › ')}</nav>`;
}

function chipActiva(activa: boolean, si = 'Activa', no = 'Desactivada'): string {
	return `<span class="estado ${activa ? 'al-dia' : ''}">${activa ? si : no}</span>`;
}

/** Fase del proyecto bien visible: «Fase: Proyecto básico» o «Fase sin indicar». */
function chipFase(fase: string | null | undefined): string {
	return `<span class="estado ${fase ? 'fase' : 'sin-fase'}">${fase ? `Fase: ${esc(textoFase(fase))}` : 'Fase sin indicar'}</span>`;
}

/** Resumen de la ficha de la promoción, o aviso si no está rellenada. */
function resumenFicha(p: Ficha): string {
	const lugar = [p.direccion, [p.codigo_postal, p.municipio].filter(Boolean).join(' '), p.provincia].filter(Boolean).join(', ');
	const partes = [
		lugar,
		p.tipo ? (p.tipo === 'plurifamiliar' ? 'Plurifamiliar' : 'Unifamiliar') : null,
		p.num_viviendas ? `${p.num_viviendas} viviendas` : null,
		p.referencia_catastral ? `Ref. catastral ${p.referencia_catastral}` : null,
		p.fecha_entrega ? `Entrega prevista: ${fecha(p.fecha_entrega)}` : null,
	].filter(Boolean) as string[];
	return partes.length ? esc(partes.join(' · ')) : '<span class="vacio">Ficha sin rellenar: la rellena la promotora en MUNE Portal.</span>';
}

/** «Razón social · CIF · domicilio», o aviso si no está rellenado. */
function resumenFiscal(d: DatosFiscales): string {
	const partes = [d.razon_social, d.cif ? `CIF ${d.cif}` : null, d.domicilio_fiscal].filter(Boolean) as string[];
	return partes.length ? esc(partes.join(' · ')) : '<span class="vacio">Datos fiscales sin rellenar: los rellena la promotora en MUNE Portal.</span>';
}

function avisador(raiz: HTMLElement): (texto: string, esError?: boolean) => void {
	return (texto, esError = false) => {
		const aviso = raiz.querySelector<HTMLElement>('[data-aviso]');
		if (!aviso) { alert(texto); return; }
		aviso.hidden = false;
		aviso.classList.toggle('error', esError);
		aviso.textContent = texto;
		aviso.scrollIntoView({ block: 'nearest' });
	};
}

async function leerPromotora(id: string): Promise<Promotora | null> {
	const { data, error } = await sb.from('promotoras').select('id, nombre, activa, razon_social, cif, domicilio_fiscal, contacto').eq('id', id).maybeSingle();
	if (error) throw error;
	return data as Promotora | null;
}

// ── Formularios de datos ──────────────────────────────────────────────────

function formFiscal(d: DatosFiscales & { contacto?: string | null }, conContacto: boolean, plegado: boolean): string {
	return `<form class="peticion-form" data-fiscal ${plegado ? 'data-plegable="fiscal" hidden' : ''} novalidate>
		<label>Razón social <input name="razon_social" maxlength="200" value="${esc(d.razon_social ?? '')}"></label>
		<label>CIF <input name="cif" maxlength="20" value="${esc(d.cif ?? '')}"></label>
		<label>Domicilio fiscal <input name="domicilio_fiscal" maxlength="300" value="${esc(d.domicilio_fiscal ?? '')}"></label>
		${conContacto ? `<label>Contacto (persona, correo o teléfono) <input name="contacto" maxlength="300" value="${esc(d.contacto ?? '')}"></label>` : ''}
		<p class="error" role="alert"></p>
		<div class="acciones">
			<button class="boton" type="submit">Guardar datos fiscales</button>
			${plegado ? '<button class="boton secundario" type="button" data-cerrar>Cancelar</button>' : ''}
		</div>
	</form>`;
}

// Ficha y datos: cada apartado plegado, con su título y de qué trata, para
// encontrarlo de un vistazo. Se recuerda cuáles estaban abiertos al volver.
const apartadosAbiertos = new Set<string>();

function apartado(clave: string, titulo: string, resumen: string, cuerpo: string): string {
	return `<details class="apartado" data-apartado="${clave}"${apartadosAbiertos.has(clave) ? ' open' : ''}>
		<summary><span class="apartado-titulo">${esc(titulo)}</span><span class="apartado-resumen">${esc(resumen)}</span></summary>
		<div class="apartado-cuerpo">${cuerpo}</div>
	</details>`;
}

function conectarApartados(raiz: HTMLElement): void {
	raiz.querySelectorAll<HTMLDetailsElement>('details[data-apartado]').forEach((d) => {
		d.addEventListener('toggle', () => {
			if (d.open) apartadosAbiertos.add(d.dataset.apartado!); else apartadosAbiertos.delete(d.dataset.apartado!);
		});
	});
}

function formFicha(p: Ficha): string {
	const num = (n: number | null) => n === null ? '' : String(n);
	return `<form class="peticion-form" data-ficha novalidate>
		<label>Dirección <input name="direccion" maxlength="200" value="${esc(p.direccion ?? '')}"></label>
		<label>Código postal <input name="codigo_postal" inputmode="numeric" maxlength="5" value="${esc(p.codigo_postal ?? '')}"></label>
		<label>Municipio <input name="municipio" maxlength="120" value="${esc(p.municipio ?? '')}"></label>
		<label>Provincia <input name="provincia" maxlength="120" value="${esc(p.provincia ?? '')}"></label>
		<label>Referencia catastral <input name="referencia_catastral" maxlength="40" value="${esc(p.referencia_catastral ?? '')}"></label>
		<label>Tipo <select name="tipo"><option value="">Sin indicar</option>
			<option value="plurifamiliar" ${p.tipo === 'plurifamiliar' ? 'selected' : ''}>Plurifamiliar</option>
			<option value="unifamiliar" ${p.tipo === 'unifamiliar' ? 'selected' : ''}>Unifamiliar</option></select></label>
		<label>Número de viviendas <input name="num_viviendas" type="number" min="1" max="5000" value="${num(p.num_viviendas)}"></label>
		<label>Número de portales o bloques <input name="num_portales" type="number" min="1" max="500" value="${num(p.num_portales)}"></label>
		<label>Número de plantas <input name="num_plantas" type="number" min="1" max="100" value="${num(p.num_plantas)}"></label>
		<label>Fecha prevista de entrega (opcional) <input name="fecha_entrega" type="date" value="${esc(p.fecha_entrega ?? '')}"></label>
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar ficha</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

const TEXTOS_LEGALES: [keyof TextosLegales, string, string][] = [
	['planos', 'Planos comerciales', 'Al pie de cada plano comercial (PDF y PNG).'],
	['renders', 'Imágenes y renders', 'En cada imagen o render.'],
	['experiencia', 'Experiencia 3D', 'En pequeño, siempre visible mientras se navega por la Experiencia 3D.'],
	['personalizacion', 'Personalización', 'En el configurador del comprador y en el documento de su selección (PDF).'],
];

function formTextosLegales(t: TextosLegales): string {
	return `<form class="peticion-form" data-legales novalidate>
		${TEXTOS_LEGALES.map(([k, titulo, donde]) => `<label>${esc(titulo)} <span class="promo-lugar">${esc(donde)}</span>
			<textarea name="${k}" rows="3" maxlength="1000">${esc(t[k] ?? '')}</textarea></label>`).join('')}
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar textos legales</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

/** Datos de la ficha leídos de un formulario, listos para guardar_ficha_promocion. */
function datosFicha(promocion: string, d: FormData): Record<string, unknown> {
	const entero = (k: string) => { const v = String(d.get(k) ?? '').trim(); return v ? Number(v) : null; };
	const cp = String(d.get('codigo_postal') ?? '').trim();
	if (cp && !/^[0-9]{5}$/.test(cp)) throw new Error('El código postal tiene que tener 5 cifras.');
	return {
		p_promocion: promocion,
		p_direccion: String(d.get('direccion') ?? ''), p_codigo_postal: cp,
		p_municipio: String(d.get('municipio') ?? ''), p_provincia: String(d.get('provincia') ?? ''),
		p_referencia_catastral: String(d.get('referencia_catastral') ?? ''), p_tipo: String(d.get('tipo') ?? ''),
		p_num_viviendas: entero('num_viviendas'), p_num_portales: entero('num_portales'), p_num_plantas: entero('num_plantas'),
		p_fecha_entrega: String(d.get('fecha_entrega') ?? '') || null,
	};
}

const camposFiscales = (d: FormData) => ({
	p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')), p_domicilio_fiscal: String(d.get('domicilio_fiscal')),
});

// ── #/promotoras ──────────────────────────────────────────────────────────

/** Una fila de «Administrador de la promotora» del alta (nombre + correo). */
function filaAdministrador(n: number): string {
	return `<div class="fila-admin" data-fila-admin>
		<label>Nombre <input name="admin_nombre" maxlength="120" ${n === 0 ? 'required' : ''} autocomplete="off"></label>
		<label>Correo <input name="admin_email" type="email" maxlength="200" ${n === 0 ? 'required' : ''} autocomplete="off"></label>
		${n > 0 ? '<button class="enlace" type="button" data-quitar-admin>Quitar</button>' : ''}
	</div>`;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function pantallaPromotoras(destino: HTMLElement): Promise<void> {
	const [pos, pcs] = await Promise.all([
		sb.from('promotoras').select('id, nombre, activa').order('nombre'),
		sb.from('promociones').select('id, promotora_id'),
	]);
	if (pos.error || pcs.error) throw pos.error ?? pcs.error;
	const promotoras = (pos.data ?? []) as Pick<Promotora, 'id' | 'nombre' | 'activa'>[];
	const cuenta = (id: string) => (pcs.data ?? []).filter((p) => p.promotora_id === id).length;

	destino.innerHTML = `
		${migas([['Promotoras', null]])}
		<section class="tarjeta">
			<h2>Promotoras</h2>
			<div class="lista-enlaces">${promotoras.map((po) => `<a class="fila-enlace" href="#/promotora/${esc(po.id)}">
				<span><strong>${esc(po.nombre)}</strong><br><span class="promo-lugar">${cuenta(po.id)} ${cuenta(po.id) === 1 ? 'promoción' : 'promociones'}</span></span>
				${chipActiva(po.activa)}
			</a>`).join('') || '<p class="vacio">Todavía no hay promotoras.</p>'}</div>
			<div class="acciones"><button class="boton secundario" type="button" data-abrir="promotora">Nueva promotora</button></div>
			<form class="peticion-form" data-plegable="promotora" data-nueva-promotora hidden novalidate>
				<h3>Datos de la empresa</h3>
				<label>Nombre de la promotora (marca) <input name="nombre" maxlength="120" required placeholder="Por ejemplo: Construcciones Ejemplo"></label>
				<label>Razón social <input name="razon_social" maxlength="200"></label>
				<label>CIF <input name="cif" maxlength="20"></label>
				<label>Domicilio fiscal <input name="domicilio_fiscal" maxlength="300"></label>
				<label>Persona de contacto (nombre, email o teléfono) <input name="contacto" maxlength="300"></label>
				<h3>${ADMIN_PROMOTORA}</h3>
				<p class="ayuda">Recibirán un email para crear su contraseña y entrar en MUNE Portal. Verán todas las promociones de la promotora
					(también las futuras) y, desde ahí, gestionarán su propio equipo y quién valida. Si falta algún dato de la empresa, lo pueden completar ellos.</p>
				<div data-admins>${filaAdministrador(0)}</div>
				<div class="acciones"><button class="boton secundario pequeno" type="button" data-otro-admin>Añadir otro administrador</button></div>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Dar de alta e invitar</button>
					<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
				</div>
			</form>
			<div data-resultado-alta hidden></div>
		</section>`;
	conectarPlegables(destino);
	const form = destino.querySelector<HTMLFormElement>('[data-nueva-promotora]')!;
	const admins = form.querySelector<HTMLElement>('[data-admins]')!;
	form.querySelector('[data-otro-admin]')!.addEventListener('click', () => {
		admins.insertAdjacentHTML('beforeend', filaAdministrador(admins.children.length));
		const nueva = admins.lastElementChild as HTMLElement;
		nueva.querySelector<HTMLButtonElement>('[data-quitar-admin]')?.addEventListener('click', () => nueva.remove());
		nueva.querySelector('input')?.focus();
	});
	alEnviar(form, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const nombres = d.getAll('admin_nombre').map((x) => String(x).trim());
		const correos = d.getAll('admin_email').map((x) => String(x).trim().toLowerCase());
		const personas = nombres.map((n, i) => ({ nombre: n, email: correos[i] ?? '' })).filter((x) => x.nombre || x.email);
		if (!personas.length) throw new Error('Indica al menos un administrador de la promotora (nombre y correo).');
		for (const x of personas) {
			if (x.nombre.length < 2) throw new Error(`Escribe el nombre de quien tiene el correo ${x.email || '(sin correo)'}.`);
			if (!CORREO.test(x.email)) throw new Error(`El correo de ${x.nombre} no es válido. Revísalo.`);
		}
		if (new Set(personas.map((x) => x.email)).size !== personas.length) throw new Error('Hay un correo repetido en los administradores.');

		const { data, error } = await sb.from('promotoras').insert({ nombre }).select('id').single();
		if (error) throw error;
		const id = data.id as string;
		await anotar('da de alta una promotora', { promotora: id, nombre });
		const resultado = destino.querySelector<HTMLElement>('[data-resultado-alta]')!;
		const filas: string[] = [];
		const { error: eDatos } = await sb.rpc('guardar_datos_promotora', {
			p_promotora: id, ...camposFiscales(d), p_contacto: String(d.get('contacto') ?? ''),
		});
		if (eDatos) filas.push(`<li class="error">${esc(fallo('La promotora está creada, pero no se han podido guardar sus datos de empresa', eDatos))} Puedes completarlos en su página.</li>`);
		for (const x of personas) {
			try {
				const mensaje = await invitar({ promotora_id: id, promocion_id: null, nombre: x.nombre, email: x.email, cargo: '', administra: true, capacidades: TODAS_LAS_CAPACIDADES });
				filas.push(`<li>✓ <strong>${esc(x.nombre)}</strong>: ${esc(mensaje)}</li>`);
			} catch (e) {
				filas.push(`<li class="error"><strong>${esc(x.nombre)}</strong>: ${esc(fallo(`No se ha podido invitar a ${x.email}`, e))} Puedes volver a intentarlo desde la página de la promotora.</li>`);
			}
		}
		form.hidden = true;
		// la nueva promotora aparece ya en la lista, sin recargar
		const lista = destino.querySelector<HTMLElement>('.lista-enlaces')!;
		lista.querySelector('.vacio')?.remove();
		lista.insertAdjacentHTML('beforeend', `<a class="fila-enlace" href="#/promotora/${esc(id)}">
			<span><strong>${esc(nombre)}</strong><br><span class="promo-lugar">0 promociones</span></span>
			${chipActiva(true)}
		</a>`);
		resultado.hidden = false;
		resultado.innerHTML = `<p class="aviso" role="status">${esc(nombre)} está dada de alta.</p>
			<ul class="resultados">${filas.join('')}</ul>
			<div class="acciones"><a class="boton" href="#/promotora/${esc(id)}">Ir a ${esc(nombre)}</a></div>`;
	});
}

// ── #/promotora/<id> ──────────────────────────────────────────────────────

export async function pantallaPromotora(destino: HTMLElement, id: string): Promise<void> {
	const po = await leerPromotora(id);
	if (!po) {
		destino.innerHTML = `${migas([['Promotoras', '#/promotoras'], ['No encontrada', null]])}<p class="vacio">No se ha encontrado esta promotora: puede que se haya borrado. Vuelve a «Promotoras».</p>`;
		return;
	}
	const [{ data: pcs, error }, accesos] = await Promise.all([
		sb.from('promociones').select('id, nombre, ubicacion, estado, activa, fase_proyecto').eq('promotora_id', id).order('nombre'),
		leerAccesos(id),
	]);
	if (error) throw error;
	const promociones = (pcs ?? []) as Pick<Promocion, 'id' | 'nombre' | 'ubicacion' | 'estado' | 'activa' | 'fase_proyecto'>[];
	const recargar = () => pantallaPromotora(destino, id);

	destino.innerHTML = `
		${migas([['Promotoras', '#/promotoras'], [po.nombre, null]])}
		<div class="cabecera"><h1>${esc(po.nombre)}</h1>${chipActiva(po.activa)}</div>
		<p class="aviso" data-aviso role="status" hidden></p>

		<section class="tarjeta">
			<h2>Promociones</h2>
			<div class="lista-enlaces">${promociones.map((p) => `<a class="fila-enlace" href="#/promocion/${esc(p.id)}">
				<span><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(textoFase(p.fase_proyecto))}</span></span>
				<span class="estado" data-estado-promo="${esc(p.id)}">…</span>
				<span data-version="${esc(p.id)}">${p.activa ? '' : chipActiva(false)}</span>
			</a>`).join('') || '<p class="vacio">Esta promotora todavía no tiene promociones.</p>'}</div>
			<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="promocion">Nueva promoción</button></div>
			<form class="peticion-form" data-nueva-promocion data-plegable="promocion" novalidate hidden>
				<label>Nombre <input name="nombre" maxlength="120" required placeholder="Por ejemplo: Residencial Las Eras"></label>
				<label>Ubicación (opcional) <input name="ubicacion" maxlength="120" placeholder="Por ejemplo: Alovera (Guadalajara)"></label>
				<label>Fase del proyecto (si ya la sabes) <select name="fase"><option value="">La indicará la promotora</option>
					${Object.entries(FASES).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
				${htmlModulos()}
				<p class="ayuda">Se creará con la lista estándar de documentos, que luego puedes ajustar. Todo esto se puede cambiar después en «Resumen y versiones».</p>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Crear promoción</button>
					<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
				</div>
			</form>
		</section>

		<section class="tarjeta">
			<h2>Acceso a todas las promociones</h2>
			<p class="ayuda">Personas que ven todas las promociones de ${esc(po.nombre)}, también las que se den de alta más adelante.
				El equipo de cada promoción se ve dentro de ella. La promotora gestiona su equipo en MUNE Portal (Equipo); aquí lo ves todo y puedes cambiarlo como soporte.</p>
			${accesos.some((a) => a.promocion_id === null && a.administra && a.activo) ? ''
				: `<p class="aviso">${esc(po.nombre)} no tiene ningún ${ADMIN_PROMOTORA.toLowerCase()} activo: nadie de la promotora puede gestionar su equipo. Da acceso a alguien marcando «${ADMIN_PROMOTORA}».</p>`}
			${tablaPersonas(accesos.filter((a) => a.promocion_id === null))}
			${po.activa ? formAcceso('todas', 'Dar acceso a todas las promociones') : ''}
		</section>

		<section class="tarjeta">
			<h2>Datos de la promotora</h2>
			<p>${resumenFiscal(po)}${po.contacto ? `<br><span class="promo-lugar">Contacto: ${esc(po.contacto)}</span>` : ''}</p>
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-abrir="fiscal">Editar datos fiscales</button>
				<button class="boton secundario pequeno" type="button" data-abrir="nombre">Cambiar nombre</button>
				<button class="boton secundario pequeno" type="button" data-exportar>Exportar todo (ZIP)</button>
				<button class="boton secundario pequeno" type="button" data-activa-promotora>${po.activa ? 'Desactivar promotora' : 'Activar promotora'}</button>
			</div>
			${po.activa ? '' : `<div class="zona-peligro" data-borrar></div>`}
			${formFiscal(po, true, true)}
			<form class="peticion-form" data-nombre data-plegable="nombre" novalidate hidden>
				<label>Nombre de la promotora (marca) <input name="nombre" maxlength="120" required value="${esc(po.nombre)}"></label>
				<p class="error" role="alert"></p>
				<div class="acciones">
					<button class="boton" type="submit">Guardar</button>
					<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
				</div>
			</form>
		</section>

		<section class="tarjeta" data-marca-general></section>

		<section class="tarjeta">
			<h2>Actividad</h2>
			<p class="ayuda">De la promotora y de todas sus promociones.</p>
			<div data-actividad><p class="vacio">Cargando…</p></div>
		</section>`;

	conectarPlegables(destino);
	pintarEstados(destino, sb, ESCAPARATE);
	conectarPersonas(destino, accesos, id, recargar, avisador(destino));
	conectarExportar(destino, destino.querySelector<HTMLButtonElement>('[data-exportar]')!, (progreso) => exportarPromotora(id, progreso));
	const zonaBorrar = destino.querySelector<HTMLElement>('[data-borrar]');
	if (zonaBorrar) void pintarBorradoPromotora(zonaBorrar, po, promociones, accesos.length);
	void pintarActividad(destino.querySelector<HTMLElement>('[data-actividad]')!, { promotora: id, promociones: promociones.map((p) => p.id) }, 30);
	const zonaMarca = destino.querySelector<HTMLElement>('[data-marca-general]')!;
	void pintarMarca(zonaMarca, { sb, esc, fecha, traducir }, { promotora: id }).catch((e) => {
		zonaMarca.innerHTML = `<h2>Marca</h2><p class="error">${esc(fallo('No se ha podido cargar la marca', e))}</p>`;
	});
	// Estado de las versiones de cada promoción, sin esperar a que cargue.
	for (const p of promociones.filter((x) => x.activa)) {
		void estadoVersiones(p.id).then((e) => {
			const hueco = destino.querySelector<HTMLElement>(`[data-version="${CSS.escape(p.id)}"]`);
			if (hueco) hueco.innerHTML = etiquetaVersiones(e);
		});
	}

	alEnviar(destino.querySelector<HTMLFormElement>('[data-nueva-promocion]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		const nuevo = identificador(nombre);
		if (nombre.length < 2 || !nuevo) throw new Error('Escribe el nombre de la promoción.');
		const { error: e } = await sb.from('promociones').insert({ id: nuevo, promotora_id: id, nombre, ubicacion: String(d.get('ubicacion')).trim() });
		if (e) throw e.code === '23505' ? new Error(`Ya hay una promoción con un nombre muy parecido («${nuevo}»). Cambia un poco el nombre.`) : e;
		await anotar('da de alta una promoción', { promocion: nuevo, promotora: id });
		const { error: eModulos } = await guardarModulos(nuevo, leerModulos(d), String(d.get('publicacion')));
		if (eModulos) console.error('[MUNE Studio]', eModulos);
		const fase = String(d.get('fase') ?? '');
		if (fase) {
			const { error: eFase } = await sb.rpc('cambiar_fase_proyecto', { p_promocion: nuevo, p_fase: fase });
			if (eFase) console.error('[MUNE Studio]', eFase);
		}
		// Lista estándar de documentos, que luego se puede ajustar.
		const { error: eLista } = await sb.rpc('aplicar_lista_estandar', { p_promocion: nuevo });
		if (eLista) {
			console.error('[MUNE Studio]', eLista);
			throw new Error('La promoción está creada, pero no se ha podido preparar su lista de documentos. Ábrela y, en «Documentación», pulsa «Ajustar la lista de documentos» y después «Añadir la lista estándar».');
		}
		location.hash = `#/promocion/${nuevo}`;
	});
	alEnviar(destino.querySelector<HTMLFormElement>('[data-fiscal]')!, async (d) => {
		const { error: e } = await sb.rpc('guardar_datos_promotora', { p_promotora: id, ...camposFiscales(d), p_contacto: String(d.get('contacto')) });
		if (e) throw e;
		await recargar();
	});
	alEnviar(destino.querySelector<HTMLFormElement>('[data-nombre]')!, async (d) => {
		const nombre = String(d.get('nombre')).trim();
		if (nombre.length < 2) throw new Error('Escribe el nombre de la promotora.');
		const { error: e } = await sb.from('promotoras').update({ nombre }).eq('id', id);
		if (e) throw e;
		await anotar('cambia el nombre de una promotora', { promotora: id, nombre });
		await recargar();
	});
	destino.querySelector('[data-activa-promotora]')!.addEventListener('click', async () => {
		if (po.activa && !confirm(`¿Desactivar ${po.nombre}?\n\nDesde este momento, nadie de esta promotora podrá entrar en MUNE Portal ni ver sus promociones. Las experiencias publicadas no cambian.\n\nSi quieres una copia de todo, cancela y pulsa antes «Exportar todo (ZIP)».`)) return;
		const { error: e } = await sb.from('promotoras').update({ activa: !po.activa }).eq('id', id);
		if (e) { avisador(destino)(traducir(e), true); return; }
		await anotar(po.activa ? 'desactiva una promotora' : 'activa una promotora', { promotora: id });
		await recargar();
	});
}

// ── Exportar y borrar (exportar.ts, 010_borrar.sql) ─────────────────────────

/** Botón «Exportar todo»: descarga el ZIP y lo cuenta en el aviso de la pantalla. */
function conectarExportar(raiz: HTMLElement, boton: HTMLButtonElement, exportar: (progreso: (t: string) => void) => Promise<Resultado>): void {
	const avisar = avisador(raiz);
	boton.addEventListener('click', async () => {
		boton.disabled = true;
		try {
			const r = await exportar((t) => avisar(t));
			avisar(r.avisos.length ? `La exportación se ha descargado (${r.archivos} archivos), pero con ${cuantos(r.avisos.length, 'aviso', 'avisos')}: míralos en el archivo LEEME.txt del ZIP.`
				: `Exportación descargada: ${r.archivos} archivos. Está en tu carpeta de Descargas.`, r.avisos.length > 0);
		} catch (e) {
			avisar(traducir(e), true);
		} finally {
			boton.disabled = false;
		}
	});
}

interface Borrado {
	que: string; // «la promoción» / «la promotora»
	nombre: string;
	promotora: string;
	promocion: string | null; // null: la promotora entera
	detalle: string; // lo que se va a borrar, en HTML
	archivos: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
	borrar: (nombre: string) => PromiseLike<{ error: { message: string } | null }>;
	retirar: string | null; // promoción con la que pedir que se retire de la web (null: ninguna)
	despues: string; // a dónde ir al terminar
}

interface Exportacion {
	id: string; estado: string; partes: unknown[]; archivos: number | null; tamano: number | null; dias: number;
	caduca_en: string | null; enviada_en: string | null; destinatarios: number | null; descargas: number; error: string | null; creada_en: string;
}

const MB = (b: number | null) => (b ?? 0) < 102400 ? `${Math.max(1, Math.round((b ?? 0) / 1024))} KB` : `${((b ?? 0) / 1048576).toFixed(1).replace('.', ',')} MB`;

/**
 * Zona roja para eliminar (045, decisión 70). Desactivar no borra nada; eliminar
 * exige antes 1) enviar la exportación a quien administra la promotora, o
 * anotar que la promotora la ha pedido sin exportación; 2) escribir el nombre.
 */
function pintarZonaBorrado(zona: HTMLElement, b: Borrado): void {
	zona.innerHTML = `
		<h2>Eliminar la información</h2>
		${b.detalle}
		<p><strong>No se puede deshacer.</strong> Desactivar no borra nada: esto sí. Se borra en MUNE y se retira de internet (la web pública y la vista previa) en unos minutos.
			Las copias de seguridad la conservan 31 días como máximo, y al recuperar una copia no vuelve. No se borran el registro de actividad, las cuentas de las personas (se quedan sin acceso)
			ni los avisos ya enviados por email; la exportación se borra cuando caduca su enlace.</p>
		<ol class="pasos">
			<li><strong>Antes de eliminar</strong>
				<div data-paso-exportacion><p class="ayuda">Cargando…</p></div>
			</li>
			${b.promocion ? '<li><strong>Portfolio</strong> (opcional) <div data-paso-portfolio><p class="ayuda">Cargando…</p></div></li>' : ''}
			<li>Escribe el nombre de ${esc(b.que)}: <strong>${esc(b.nombre)}</strong>
				<form class="peticion-form" data-form-borrar novalidate>
					<input name="nombre" autocomplete="off" disabled aria-label="Nombre para confirmar">
					<p class="error" data-error-borrar role="alert"></p>
					<div class="acciones"><button class="boton peligro" type="submit" disabled>Eliminar para siempre</button></div>
				</form>
			</li>
		</ol>`;
	const form = zona.querySelector<HTMLFormElement>('[data-form-borrar]')!;
	const boton = form.querySelector<HTMLButtonElement>('button')!;
	const campo = form.querySelector<HTMLInputElement>('input')!;
	const error = zona.querySelector<HTMLElement>('[data-error-borrar]')!;
	const coincide = () => campo.value.trim() === b.nombre.trim();
	const permitir = (si: boolean) => {
		campo.disabled = !si;
		boton.disabled = !si || !coincide();
	};

	void pintarPasoExportacion(zona.querySelector<HTMLElement>('[data-paso-exportacion]')!, b, permitir);
	if (b.promocion) void pintarPasoPortfolio(zona.querySelector<HTMLElement>('[data-paso-portfolio]')!, b.promocion);
	campo.addEventListener('input', () => { boton.disabled = campo.disabled || !coincide(); });
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		if (!coincide() || !confirm(`¿Eliminar ${b.nombre} para siempre?\n\nNo se puede deshacer.`)) return;
		boton.disabled = true;
		error.textContent = '';
		try {
			// 0. Antes de nada, que la eliminación quede guardada fuera de Supabase (045): si no, no se elimina.
			await esperarEliminacionGuardada(b.promocion ? 'promocion' : 'promotora', b.promocion ?? b.promotora, campo.value, (t) => { boton.textContent = t; });
			boton.textContent = 'Borrando archivos…';
			// 1. Los archivos, con la API de almacenamiento (de 100 en 100).
			const { data: lista, error: e1 } = await b.archivos();
			if (e1) throw e1;
			const porAlmacen = new Map<string, string[]>();
			for (const a of (lista ?? []) as { bucket: string; nombre: string }[]) porAlmacen.set(a.bucket, [...(porAlmacen.get(a.bucket) ?? []), a.nombre]);
			for (const [almacen, nombres] of porAlmacen) {
				for (let i = 0; i < nombres.length; i += 100) {
					const { error: e2 } = await sb.storage.from(almacen).remove(nombres.slice(i, i + 100));
					if (e2) throw e2;
				}
			}
			// 2. Las fichas (la base de datos comprueba la exportación y que no queda ningún archivo).
			boton.textContent = 'Borrando…';
			const { error: e3 } = await b.borrar(campo.value);
			if (e3) throw e3;
			// 3. Retirarla de internet (037): la web se vuelve a montar sin ella.
			if (b.retirar) {
				boton.textContent = 'Retirando de la web…';
				const { error: e4 } = await sb.functions.invoke('ejecutar', { body: { accion: 'retirar', promocion: b.retirar } });
				if (e4) {
					alert('Se ha eliminado, pero no se ha podido pedir que se retire de la web. En GitHub → Actions → «Enviar la web a Cloudflare» → Run workflow, o díselo a Claude.');
				}
			}
			location.hash = b.despues;
		} catch (e) {
			error.textContent = traducir(e);
			boton.textContent = 'Eliminar para siempre';
			boton.disabled = false;
		}
	});
}

/**
 * Apunta la eliminación y espera a que eliminaciones.yml la guarde fuera de Supabase (lo lanza la propia
 * base de datos; aquí solo se vuelve a pedir por si acaso). Sin eso, borrar_* no deja eliminar.
 */
async function esperarEliminacionGuardada(tipo: 'promocion' | 'promotora', id: string, nombre: string, aviso: (t: string) => void): Promise<void> {
	const inicio = Date.now();
	let pedida = 0;
	for (;;) {
		const { data, error } = await sb.rpc('pedir_eliminacion', { p_tipo: tipo, p_id: id, p_nombre: nombre });
		if (error) throw error;
		if (data === 'guardada') return;
		if (Date.now() - pedida > 60000) {
			pedida = Date.now();
			void sb.functions.invoke('exportacion', { body: { accion: 'sincronizar' } });
		}
		if (Date.now() - inicio > 5 * 60000) {
			throw new Error('Todavía no se ha podido guardar la eliminación fuera de MUNE. No se ha eliminado nada: vuelve a pulsar «Eliminar para siempre» en unos minutos (si sigue igual, díselo a Claude).');
		}
		aviso(`Guardando la eliminación fuera de Supabase… (${Math.round((Date.now() - inicio) / 1000)} s)`);
		await new Promise((ok) => setTimeout(ok, 5000));
	}
}

/** Paso 1: la exportación para la promotora (o la petición de eliminar sin ella). */
async function pintarPasoExportacion(caja: HTMLElement, b: Borrado, permitir: (si: boolean) => void): Promise<void> {
	const filtrar = <T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(q: T) => b.promocion ? q.eq('promocion_id', b.promocion) : q.is('promocion_id', null);
	const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
	const [{ data: exps }, { data: peticiones }] = await Promise.all([
		filtrar(sb.from('exportaciones').select('*').eq('promotora_id', b.promotora)).order('creada_en', { ascending: false }).limit(1),
		filtrar(sb.from('eliminaciones_sin_exportacion').select('*').eq('promotora_id', b.promotora)).gte('anotado_en', hace30).order('anotado_en', { ascending: false }).limit(1),
	]);
	const e = (exps?.[0] ?? null) as Exportacion | null;
	const sinExp = (peticiones?.[0] ?? null) as { solicitado_por: string; motivo: string; anotado_en: string } | null;
	const vigente = e?.estado === 'enviada' && !!e.caduca_en && new Date(e.caduca_en) > new Date();
	permitir(vigente || !!sinExp);
	const recargar = () => void pintarPasoExportacion(caja, b, permitir);
	const enviar = async (id: string, aviso: HTMLElement) => {
		aviso.textContent = 'Enviando el email…';
		const { data, error } = await sb.functions.invoke('exportacion', { body: { accion: 'enviar', id } });
		if (error) {
			const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
			aviso.textContent = cuerpo?.error ?? 'No se ha podido enviar el email. La exportación sigue preparada: vuelve a pulsar «Enviar».';
			aviso.classList.add('error');
			return;
		}
		aviso.textContent = `Enviando el email a ${cuantos(Number(data?.destinatarios ?? 0), 'persona', 'personas')}…`;
		recargar();
	};

	if (e?.estado === 'enviando') {
		caja.innerHTML = `<p>Enviando el email a quien administra la promotora… Se confirma en un par de minutos.</p>
			<p class="ayuda" role="status">Si en unos minutos no se confirma, la exportación vuelve a quedar preparada para enviarla otra vez.</p>`;
		setTimeout(() => { if (caja.isConnected) recargar(); }, 10000);
		return;
	}

	if (sinExp) {
		caja.innerHTML = `<p class="ok">✓ Anotado el ${esc(fecha(sinExp.anotado_en))}: la promotora ha pedido eliminarla <strong>sin exportación</strong> (lo pidió ${esc(sinExp.solicitado_por)}; ${esc(sinExp.motivo)}).</p>`;
		return;
	}
	if (vigente && e) {
		caja.innerHTML = `<p class="ok">✓ Exportación enviada el ${esc(fecha(e.enviada_en!))} a quien administra la promotora (${cuantos(e.destinatarios ?? 0, 'persona', 'personas')})
				(${cuantos(e.partes.length, 'parte', 'partes')}, ${cuantos(e.archivos ?? 0, 'archivo', 'archivos')}, ${MB(e.tamano)}). El enlace funciona hasta el ${esc(fecha(e.caduca_en!))}${e.descargas ? `; se ha abierto ${cuantos(e.descargas, 'vez', 'veces')}` : '; todavía no se ha abierto'}.</p>
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-reenviar>Enviar un enlace nuevo</button>
				<button class="boton secundario pequeno" type="button" data-revocar>Revocar el enlace</button>
			</div>
			<p class="ayuda" data-aviso role="status">Un enlace nuevo anula el anterior. Revocarlo borra la exportación.</p>`;
		const aviso = caja.querySelector<HTMLElement>('[data-aviso]')!;
		caja.querySelector('[data-reenviar]')!.addEventListener('click', () => void enviar(e.id, aviso));
		caja.querySelector('[data-revocar]')!.addEventListener('click', async () => {
			if (!confirm('¿Revocar el enlace? Dejará de funcionar y se borrará la exportación.')) return;
			const { error } = await sb.functions.invoke('exportacion', { body: { accion: 'revocar', id: e.id } });
			if (error) { aviso.textContent = 'No se ha podido revocar. Vuelve a probar.'; return; }
			recargar();
		});
		return;
	}
	if (e?.estado === 'lista') {
		caja.innerHTML = `<p>Exportación preparada y comprobada: ${cuantos(e.partes.length, 'parte', 'partes')}, ${cuantos(e.archivos ?? 0, 'archivo', 'archivos')}, ${MB(e.tamano)}. Falta enviarla.</p>
			${e.error ? `<p class="error">El último envío no salió: ${esc(e.error)}</p>` : ''}
			<div class="acciones"><button class="boton pequeno" type="button" data-enviar>Enviar a quien administra la promotora</button>
				<button class="boton secundario pequeno" type="button" data-descartar>Descartarla y preparar otra</button></div>
			<p class="ayuda" data-aviso role="status"></p>`;
		const aviso = caja.querySelector<HTMLElement>('[data-aviso]')!;
		caja.querySelector('[data-enviar]')!.addEventListener('click', () => void enviar(e.id, aviso));
		caja.querySelector('[data-descartar]')!.addEventListener('click', async () => {
			if (!confirm('¿Descartar esta exportación? Se borran sus archivos y podrás preparar otra.')) return;
			const { error } = await sb.functions.invoke('exportacion', { body: { accion: 'revocar', id: e.id } });
			if (error) { aviso.textContent = 'No se ha podido descartar. Vuelve a probar.'; return; }
			recargar();
		});
		return;
	}
	caja.innerHTML = `
		${e?.estado === 'fallida' ? `<p class="error">La última preparación no se completó: ${esc(e.error ?? 'sin detalle')}. Puedes volver a prepararla.</p>` : ''}
		${e?.estado === 'caducada' || e?.estado === 'revocada' ? `<p class="ayuda">La última exportación ${e.estado === 'caducada' ? 'caducó' : 'se revocó'}: prepara otra.</p>` : ''}
		<form class="peticion-form" data-exportar-form novalidate>
			<label class="opcion"><input type="radio" name="modo" value="exportar" checked> Enviar su exportación a quien administra la promotora</label>
			<p class="ayuda">MUNE la prepara (solo su documentación, los planos y materiales entregados y los datos de la promoción; nada interno de MUNE), la comprueba y envía un email con un enlace privado. No se descarga en tu ordenador.</p>
			<label class="en-linea">El enlace caduca a los <input class="corto" name="dias" type="number" min="1" max="90" value="30"> días</label>
			<label class="opcion"><input type="radio" name="modo" value="sin"> La promotora ha pedido eliminarla sin exportación</label>
			<div data-sin hidden>
				<label>Quién lo ha pedido <input name="quien" maxlength="200" placeholder="Nombre y cargo"></label>
				<label>Cómo y cuándo <input name="como" maxlength="500" placeholder="Por ejemplo: email del 3/11/2026"></label>
			</div>
			<p class="error" data-error role="alert"></p>
			<div class="acciones"><button class="boton pequeno" type="submit">Preparar y enviar</button></div>
			<p class="ayuda" data-aviso role="status"></p>
		</form>`;
	const f = caja.querySelector<HTMLFormElement>('[data-exportar-form]')!;
	const sin = f.querySelector<HTMLElement>('[data-sin]')!;
	const err = f.querySelector<HTMLElement>('[data-error]')!;
	const aviso = f.querySelector<HTMLElement>('[data-aviso]')!;
	const enviarBoton = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
	f.addEventListener('change', () => {
		const modo = new FormData(f).get('modo');
		sin.hidden = modo !== 'sin';
		enviarBoton.textContent = modo === 'sin' ? 'Anotar la petición' : 'Preparar y enviar';
	});
	f.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		err.textContent = '';
		const d = new FormData(f);
		enviarBoton.disabled = true;
		try {
			if (d.get('modo') === 'sin') {
				const { error } = await sb.rpc('anotar_eliminacion_sin_exportacion', { p_promotora: b.promotora, p_promocion: b.promocion, p_solicitado_por: String(d.get('quien') ?? ''), p_motivo: String(d.get('como') ?? '') });
				if (error) throw error;
				recargar();
				return;
			}
			const r = await prepararExportacion(b.promotora, b.promocion, Number(d.get('dias') || 30), (t) => { aviso.textContent = t; });
			aviso.textContent = `✓ Preparada y comprobada: ${cuantos(r.partes, 'parte', 'partes')}, ${cuantos(r.archivos, 'archivo', 'archivos')}, ${MB(r.bytes)}.`;
			await enviar(r.id, aviso);
			recargar();
		} catch (e) {
			err.textContent = `${fallo('No se ha podido preparar la exportación', e)} No se ha eliminado nada: puedes volver a intentarlo.`;
			enviarBoton.disabled = false;
		}
	});
}

/** Portfolio (solo con autorización de la promotora y solo planos y materiales de MUNE). */
async function pintarPasoPortfolio(caja: HTMLElement, promocion: string): Promise<void> {
	const [{ data: auts }, { data: entregables }] = await Promise.all([
		sb.from('portfolio_autorizaciones').select('*, portfolio_piezas(id, titulo, origen)').eq('promocion_id', promocion).is('retirada_en', null).order('id', { ascending: false }),
		sb.from('entregables').select('id, version, nombre, titulo, ruta, huella').eq('promocion_id', promocion).order('id'),
	]);
	const aut = (auts?.[0] ?? null) as { id: number; autorizada_por: string; fecha: string; alcance: string; portfolio_piezas: { id: number; titulo: string; origen: string }[] } | null;
	const recargar = () => void pintarPasoPortfolio(caja, promocion);
	if (!aut) {
		caja.innerHTML = `<p class="ayuda">Al eliminar no se guarda nada para el portfolio. Si la promotora autoriza usar algunos resultados (planos comerciales, imágenes), anótalo y elige cuáles: se guardan aparte, sin originales ni datos privados.</p>
			<form class="peticion-form" data-autorizar novalidate>
				<label>Quién lo autoriza <input name="por" maxlength="200" placeholder="Nombre y cargo"></label>
				<label>Fecha <input name="fecha" type="date"></label>
				<label>Qué autoriza <input name="alcance" maxlength="500" placeholder="Por ejemplo: planos comerciales en la web de MUNE"></label>
				<label>Documento o email de la autorización (opcional) <input name="doc" maxlength="300"></label>
				<p class="error" data-error role="alert"></p>
				<div class="acciones"><button class="boton secundario pequeno" type="submit">Anotar la autorización</button></div>
			</form>`;
		alEnviar(caja.querySelector<HTMLFormElement>('[data-autorizar]')!, async (d) => {
			const { error } = await sb.rpc('autorizar_portfolio', { p_promocion: promocion, p_autorizada_por: String(d.get('por') ?? ''), p_fecha: String(d.get('fecha') || '') || null, p_alcance: String(d.get('alcance') ?? ''), p_documento: String(d.get('doc') ?? '') });
			if (error) throw error;
			recargar();
		});
		return;
	}
	const guardadas = new Set(aut.portfolio_piezas.map((x) => x.origen));
	const lista = ((entregables ?? []) as { id: number; version: string; nombre: string; titulo: string | null; ruta: string; huella: string }[]);
	caja.innerHTML = `<p class="ok">Autorizado por ${esc(aut.autorizada_por)} el ${esc(fecha(aut.fecha))}: ${esc(aut.alcance)}. ${cuantos(aut.portfolio_piezas.length, 'pieza guardada', 'piezas guardadas')}.</p>
		${lista.length ? `<form class="peticion-form" data-piezas novalidate>
			${lista.map((e) => `<label class="opcion"><input type="checkbox" name="e" value="${e.id}" ${guardadas.has(`entregable ${e.version} · ${e.titulo ?? e.nombre}`) ? 'checked disabled' : ''}> ${esc(e.version)} · ${esc(e.titulo ?? e.nombre)}</label>`).join('')}
			<p class="error" data-error role="alert"></p>
			<div class="acciones"><button class="boton secundario pequeno" type="submit">Guardar en el portfolio</button>
				<button class="boton secundario pequeno" type="button" data-retirar>La promotora retira la autorización</button></div>
		</form>` : '<p class="ayuda">Esta promoción no tiene planos ni materiales entregados.</p>'}`;
	caja.querySelector('[data-retirar]')?.addEventListener('click', async () => {
		if (!confirm('¿Retirar la autorización? Se borran del portfolio las piezas de esta promoción.')) return;
		const { data: rutas, error } = await sb.rpc('retirar_portfolio', { p_autorizacion: aut.id });
		if (error) { alert(traducir(error)); return; }
		const nombres = ((rutas ?? []) as unknown as string[]).map((r) => (typeof r === 'string' ? r : String((r as { ruta?: string }).ruta ?? r)));
		if (nombres.length) await sb.storage.from('portfolio').remove(nombres);
		recargar();
	});
	const fp = caja.querySelector<HTMLFormElement>('[data-piezas]');
	if (fp) alEnviar(fp, async (d) => {
		for (const id of d.getAll('e').map(Number)) {
			const e = lista.find((x) => x.id === id)!;
			const { data: archivo, error: e1 } = await sb.storage.from('entregables').download(e.ruta);
			if (e1 || !archivo) throw e1 ?? new Error('No se ha podido leer el entregable');
			const ruta = `${aut.id}/${e.version}-${e.ruta.split('/').pop()}`;
			const { error: e2 } = await sb.storage.from('portfolio').upload(ruta, archivo, { upsert: true });
			if (e2) throw e2;
			const { error: e3 } = await sb.rpc('pieza_de_portfolio', { p_autorizacion: aut.id, p_entregable: id, p_ruta: ruta, p_titulo: e.titulo ?? e.nombre });
			if (e3) throw e3;
		}
		recargar();
	});
}

/** Cuántas filas de una tabla tiene una promoción (o varias). */
async function contar(tabla: string, promociones: string[]): Promise<number> {
	if (!promociones.length) return 0;
	const { count } = await sb.from(tabla).select('id', { count: 'exact', head: true }).in('promocion_id', promociones);
	return count ?? 0;
}

/** Aviso si alguna promoción tiene experiencia publicada: al borrarla, se retira también de internet. */
async function avisoWebs(promociones: { id: string; nombre: string }[]): Promise<string> {
	const conWeb = (await Promise.all(promociones.map(async (p) => {
		const e = await estadoVersiones(p.id);
		return e.pub ?? e.rev ? p : null;
	}))).filter((p) => p !== null);
	return conWeb.length ? `<p class="aviso">${conWeb.length === 1 ? `«${esc(conWeb[0].nombre)}» tiene experiencia publicada o en vista previa` : `Tienen experiencia publicada o en vista previa: ${conWeb.map((p) => `«${esc(p.nombre)}»`).join(', ')}`}.
		Al borrar, <strong>se retira también de internet</strong> (la web pública y la vista previa) y se borran sus datos 3D y sus versiones.</p>` : '';
}

async function pintarBorradoPromocion(zona: HTMLElement, p: Promocion): Promise<void> {
	const ids = [p.id];
	const [docs, equipo, peticiones, planos, archivos, web] = await Promise.all([
		contar('documentos', ids), contar('miembros', ids), contar('peticiones', ids), contar('entregables', ids),
		sb.rpc('archivos_de_promocion', { p_id: p.id }), avisoWebs([p]),
	]);
	pintarZonaBorrado(zona, {
		que: 'la promoción', nombre: p.nombre,
		detalle: `<p>Se borrará todo lo de <strong>${esc(p.nombre)}</strong>: ${cuantos(docs, 'documento subido', 'documentos subidos')}, ${cuantos(planos, 'plano entregado', 'planos entregados')},
			${cuantos((archivos.data as unknown[] | null)?.length ?? 0, 'archivo guardado', 'archivos guardados')}, ${cuantos(equipo, 'acceso de su equipo', 'accesos de su equipo')} y ${cuantos(peticiones, 'petición de cambios', 'peticiones de cambios')}.</p>${web}`,
		promotora: p.promotora_id, promocion: p.id,
		archivos: () => sb.rpc('archivos_de_promocion', { p_id: p.id }),
		borrar: (nombre) => sb.rpc('borrar_promocion', { p_id: p.id, p_nombre: nombre }),
		retirar: p.id,
		despues: `#/promotora/${p.promotora_id}`,
	});
}

async function pintarBorradoPromotora(zona: HTMLElement, po: Promotora, promociones: { id: string; nombre: string }[], personas: number): Promise<void> {
	const ids = promociones.map((p) => p.id);
	const [docs, peticiones, archivos, web] = await Promise.all([
		contar('documentos', ids), contar('peticiones', ids), sb.rpc('archivos_de_promotora', { p_id: po.id }), avisoWebs(promociones),
	]);
	pintarZonaBorrado(zona, {
		que: 'la promotora', nombre: po.nombre,
		detalle: `<p>Se borrará <strong>${esc(po.nombre)}</strong> con todo lo suyo: ${cuantos(promociones.length, 'promoción', 'promociones')} (también las activas),
			${cuantos(docs, 'documento subido', 'documentos subidos')}, ${cuantos((archivos.data as unknown[] | null)?.length ?? 0, 'archivo guardado', 'archivos guardados')}, ${cuantos(personas, 'acceso', 'accesos')}, ${cuantos(peticiones, 'petición de cambios', 'peticiones de cambios')}, sus datos fiscales y su marca.</p>
			<p class="ayuda">Si la promotora puede volver más adelante, no la borres: desactívala. Se conserva todo (marca, equipo y datos) y basta con volver a activarla.</p>${web}`,
		promotora: po.id, promocion: null,
		archivos: () => sb.rpc('archivos_de_promotora', { p_id: po.id }),
		borrar: (nombre) => sb.rpc('borrar_promotora', { p_id: po.id, p_nombre: nombre }),
		retirar: promociones[0]?.id ?? null,
		despues: '#/promotoras',
	});
}

// ── #/promocion/<id>/<pestaña> ────────────────────────────────────────────

export async function pantallaPromocion(destino: HTMLElement, id: string, pestana: string): Promise<void> {
	const { data, error } = await sb.from('promociones').select(CAMPOS_PROMOCION).eq('id', id).maybeSingle();
	if (error) throw error;
	const p = data as Promocion | null;
	if (!p) {
		destino.innerHTML = `${migas([['Promotoras', '#/promotoras'], ['No encontrada', null]])}<p class="vacio">No se ha encontrado esta promoción: puede que se haya borrado. Vuelve a «Promotoras».</p>`;
		return;
	}
	const po = await leerPromotora(p.promotora_id);
	const actual = PESTANAS.some(([k]) => k === pestana) ? pestana : 'resumen';

	destino.innerHTML = `
		${migas([['Promotoras', '#/promotoras'], [po?.nombre ?? '—', `#/promotora/${p.promotora_id}`], [p.nombre, null]])}
		<div class="cabecera"><div><h1>${esc(p.nombre)}</h1><p class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(p.id)}</p></div>
			<div class="chips">${chipFase(p.fase_proyecto)}${chipActiva(p.activa, 'Visible para su equipo', 'Desactivada')}</div></div>
		<nav class="pestanas" aria-label="Secciones de la promoción">${PESTANAS.map(([k, t]) =>
			`<a href="#/promocion/${esc(id)}/${k}" ${k === actual ? 'aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>
		<p class="aviso" data-aviso role="status" hidden></p>
		<section class="tarjeta" data-pestana><p class="vacio">Cargando…</p></section>`;
	const caja = destino.querySelector<HTMLElement>('[data-pestana]')!;
	const recargar = () => pantallaPromocion(destino, id, actual);

	if (actual === 'resumen') {
		caja.innerHTML = `
			<h2>Fase del proyecto</h2>
			<p>${chipFase(p.fase_proyecto)} <a href="#/promocion/${esc(id)}/documentacion">Ver el historial de fases en Documentación</a></p>
			<p class="ayuda">${p.fase_proyecto ? 'La indica la promotora en MUNE Portal, en Documentación. Los documentos que sube quedan marcados con esta fase.' : 'La promotora todavía no ha indicado en qué fase está el proyecto. Puede hacerlo en MUNE Portal, en Documentación (o tú, desde la pestaña Documentación).'}</p>
			<h2 class="separado">Versiones</h2>
			<div data-versiones></div>
			<h2 class="separado">Partes de la promoción y publicación</h2>
			<form class="peticion-form" data-modulos novalidate>
				${htmlModulos(p.modulos ?? MODULOS_POR_DEFECTO, p.publicacion)}
				<p class="error" role="alert"></p>
				<div class="acciones"><button class="boton pequeno" type="submit">Guardar</button></div>
			</form>
			<h2 class="separado">Estado</h2>
			<p class="en-linea">Estado que ve la promotora: <span class="estado" data-estado-promo="${esc(id)}">…</span></p>
			<p class="ayuda">Se calcula solo: «En preparación», «En validación» (has enviado una versión a validar) o «Publicada».</p>
			<p class="promo-versiones">${resumenFicha(p)}</p>
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-exportar>Exportar todo (ZIP)</button>
				<button class="boton secundario pequeno" type="button" data-activa-promo>${p.activa ? 'Desactivar promoción' : 'Activar promoción'}</button>
			</div>
			${p.activa ? '' : `<div class="zona-peligro" data-borrar></div>`}`;
		void pintarVersiones(caja.querySelector<HTMLElement>('[data-versiones]')!, p);
		const zonaBorrar = caja.querySelector<HTMLElement>('[data-borrar]');
		if (zonaBorrar) void pintarBorradoPromocion(zonaBorrar, p);
		conectarExportar(destino, caja.querySelector<HTMLButtonElement>('[data-exportar]')!, (progreso) => exportarPromocion(id, progreso));
		alEnviar(caja.querySelector<HTMLFormElement>('[data-modulos]')!, async (d) => {
			const { error: e } = await guardarModulos(id, leerModulos(d), String(d.get('publicacion')));
			if (e) throw e;
			await recargar();
			avisador(destino)('✓ Partes de la promoción y publicación guardadas.');
		});
		pintarEstados(caja, sb, ESCAPARATE);
		caja.querySelector('[data-activa-promo]')!.addEventListener('click', async () => {
			if (p.activa && !confirm(`¿Desactivar ${p.nombre}?\n\nDesde este momento, su equipo dejará de verla en MUNE Portal. La experiencia publicada no cambia.\n\nSi quieres una copia de todo, cancela y pulsa antes «Exportar todo (ZIP)».`)) return;
			const { error: e } = await sb.from('promociones').update({ activa: !p.activa }).eq('id', id);
			if (e) { avisador(destino)(traducir(e), true); return; }
			await anotar(p.activa ? 'desactiva una promoción' : 'activa una promoción', { promocion: id });
			await recargar();
		});
	}

	if (actual === 'equipo') {
		const accesos = await leerAccesos(p.promotora_id);
		const todas = accesos.filter((a) => a.promocion_id === null && a.activo);
		caja.innerHTML = `
			<h2>Equipo de la promoción</h2>
			<p class="ayuda">La promotora gestiona su equipo en MUNE Portal (Equipo): quien la administra da accesos, capacidades y decide quién valida. Aquí lo ves todo y puedes cambiarlo como soporte; queda registrado.</p>
			${tablaPersonas(accesos.filter((a) => a.promocion_id === id))}
			${po?.activa ? formAcceso(id, 'Añadir persona al equipo') : '<p class="vacio">La promotora está desactivada: actívala para dar accesos.</p>'}
			<h2 class="separado">También la ven</h2>
			${todas.length ? `<ul class="lista-simple">${todas.map((a) => `<li>${esc(a.nombre)}${a.cargo ? ` (${esc(a.cargo)})` : ''} ${insignias(a)}</li>`).join('')}</ul>
				<p class="ayuda">Tienen acceso a todas las promociones de ${esc(po?.nombre ?? '')}. Se gestiona en <a href="#/promotora/${esc(p.promotora_id)}">la página de la promotora</a>.</p>`
				: '<p class="vacio">Nadie más.</p>'}
			<p class="ayuda">${ADMIN_PROMOCION}: tiene todas las capacidades en esta promoción y gestiona a sus personas.</p>`;
		conectarPlegables(caja);
		conectarPersonas(caja, accesos, p.promotora_id, recargar, avisador(destino));
	}

	if (actual === 'documentacion') await pintarDocumentacion(caja, p);

	if (actual === 'ficha') {
		const ref = (p as unknown as { referencia_catastral?: string | null }).referencia_catastral ?? null;
		caja.innerHTML = `
			<h2>Ficha y datos</h2>
			<p class="ayuda">Abre el apartado que necesites.</p>
			${apartado('ficha', 'Ficha de la promoción', 'Dirección, referencia catastral, viviendas, plantas y fechas', `
				<p class="ayuda">Normalmente la rellena la promotora en MUNE Portal; aquí puedes revisarla o completarla.</p>
				${formFicha(p)}`)}
			${apartado('fiscal', 'Datos fiscales de la promoción', 'La sociedad de esta promoción', `
				<p class="ayuda">La sociedad de esta promoción (puede ser distinta de la de la promotora).</p>
				${formFiscal(p, false, false)}
				<p class="ok" data-guardado-fiscal role="status"></p>`)}
			${apartado('formalizacion', 'Formalización de la personalización', 'A quién envía el comprador su documento y datos para la transferencia', `
				<p class="ayuda">A quién envía el comprador su documento firmado y los datos para la transferencia. Normalmente lo rellena la promotora en MUNE Portal; solo lo ven los compradores con código.</p>
				${formFormalizacion(p.formalizacion)}`)}
			${apartado('solicitar', 'Solicitar información', 'El botón de contacto de la experiencia pública', `
				<p class="ayuda">El botón «Solicitar información» de la experiencia pública: lleva a la web de la promotora o a un email, o abre su formulario encima del 3D. Normalmente lo pone la promotora en MUNE Portal. Se aplica al momento.</p>
				${formSolicitar(p, esc)}`)}
			${apartado('legales', 'Textos legales', 'Los avisos de planos, renders, 3D y personalización', `
				<p class="ayuda">Los escribe la promotora en MUNE Portal. Se aplican en la próxima versión que prepares: se revisan en la vista previa y se publican con ella.</p>
				${formTextosLegales(p.textos_legales ?? {})}`)}
			${apartado('entorno', 'Entorno real', 'Edificios, calles, relieve y foto aérea de alrededor', '<section data-entorno></section>')}`;
		conectarApartados(caja);
		const zonaEntorno = caja.querySelector<HTMLElement>('[data-entorno]')!;
		void pintarEntorno(zonaEntorno, id, ref);
		const form = caja.querySelector<HTMLFormElement>('[data-formalizacion]')!;
		alEnviar(form, async (d) => {
			const { error: e } = await sb.rpc('guardar_formalizacion', datosFormalizacion(id, d));
			if (e) throw e;
			form.querySelector<HTMLElement>('[data-guardado]')!.textContent = '✓ Guardado.';
			form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
		});
		conectarSolicitar(caja, sb, id, traducir);
		const legales = caja.querySelector<HTMLFormElement>('[data-legales]')!;
		alEnviar(legales, async (d) => {
			const texto = (k: string) => String(d.get(k) ?? '').trim();
			const { error: e } = await sb.rpc('guardar_textos_legales', {
				p_promocion: id, p_planos: texto('planos'), p_renders: texto('renders'), p_experiencia: texto('experiencia'), p_personalizacion: texto('personalizacion'),
			});
			if (e) throw e;
			legales.querySelector<HTMLElement>('[data-guardado]')!.textContent = '✓ Textos legales guardados. Se aplicarán en la próxima versión que prepares.';
			legales.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
		});
		const ficha = caja.querySelector<HTMLFormElement>('[data-ficha]')!;
		alEnviar(ficha, async (d) => {
			const { error: e } = await sb.rpc('guardar_ficha_promocion', datosFicha(id, d));
			if (e) throw e;
			ficha.querySelector<HTMLElement>('[data-guardado]')!.textContent = '✓ Ficha guardada.';
			ficha.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
			const nueva = String(d.get('referencia_catastral') ?? '').trim() || null;
			if (nueva !== ref) void pintarEntorno(zonaEntorno, id, nueva);
		});
		const fiscal = caja.querySelector<HTMLFormElement>('[data-fiscal]')!;
		alEnviar(fiscal, async (d) => {
			const { error: e } = await sb.rpc('guardar_datos_promocion', { p_promocion: id, ...camposFiscales(d) });
			if (e) throw e;
			caja.querySelector<HTMLElement>('[data-guardado-fiscal]')!.textContent = '✓ Datos fiscales guardados.';
			fiscal.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
		});
	}

	if (actual === 'compradores' && p.modulos?.acceso_comprador === false) {
		caja.innerHTML = '<h2>Compradores</h2><p class="vacio">Esta promoción no tiene activado el acceso de compradores. Actívalo en «Resumen y versiones» → «Partes de la promoción» si lo necesita.</p>';
	} else if (actual === 'compradores') {
		await pintarCompradores(caja, { sb, esc, fecha, traducir, escaparate: ESCAPARATE, revision: REVISION, modo: 'administradora' }, p);
	}

	if (actual === 'personalizacion' && p.modulos?.personalizacion === false) {
		caja.innerHTML = '<h2>Personalización</h2><p class="vacio">Esta promoción no tiene activada la personalización. Actívala en «Resumen y versiones» → «Partes de la promoción» si la necesita.</p>';
	} else if (actual === 'personalizacion') {
		caja.innerHTML = '<div data-selecciones><p class="vacio">Cargando…</p></div><section class="separado" data-catalogo></section>';
		await Promise.all([
			pintarPersonalizacion(caja.querySelector<HTMLElement>('[data-selecciones]')!, { sb, esc, fecha, traducir, modo: 'administradora' }, p),
			pintarCatalogo(caja.querySelector<HTMLElement>('[data-catalogo]')!, { sb, esc, fecha, traducir, modo: 'administradora' }, p),
		]);
	}

	if (actual === 'marca') {
		await pintarMarca(caja, { sb, esc, fecha, traducir }, { promotora: p.promotora_id, promocion: { id: p.id, nombre: p.nombre }, enlaceGeneral: `#/promotora/${p.promotora_id}` });
	}

	if (actual === 'peticiones') {
		caja.innerHTML = '<h2>Peticiones de cambios</h2><div data-peticiones><p class="vacio">Cargando…</p></div>';
		const e = await estadoVersiones(id);
		await pintarPeticiones(caja.querySelector<HTMLElement>('[data-peticiones]')!, p, (e.rev ?? e.pub)?.version ?? null);
	}

	if (actual === 'actividad') {
		caja.innerHTML = '<h2>Actividad de la promoción</h2><div data-actividad><p class="vacio">Cargando…</p></div>';
		await pintarActividad(caja.querySelector<HTMLElement>('[data-actividad]')!, { promocion: id });
	}
}
