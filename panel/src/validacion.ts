// Validación de una versión por la promotora (decisión 40 · 020_equipos_y_validaciones.sql).
//
// Dos partes, cada una con su propia lista de aprobadores, que define la
// promotora en MUNE Portal (MUNE Studio la puede cambiar como soporte):
//
// · Planos comerciales: uno por plano (planos.json de la vista previa, planos.ts).
// · Experiencia 3D: una por tipología o variante (experiencia.json de la vista
//   previa). No hay archivo: se valida en la vista previa (?ver=<clave>).
//
// Un elemento queda validado cuando aprueban todas las personas designadas; si
// no cambia entre versiones (misma huella), conserva su aprobación. Solo se
// publica con las dos partes validadas. Las versiones preparadas antes de que
// existiera una parte (sin su .json en la vista previa) no la necesitan.

import { avisarPromotora } from './avisos';
import { anotar, esc, fallo, fecha, sb, traducir } from './comun';
import { leerAccesos } from './equipo';
import { enviarPlanos, leerManifiesto, type Manifiesto } from './planos';

export type Tipo = 'planos' | 'experiencia';
export type Lista = 'sin_enviar' | 'sin_aprobadores' | 'cambios' | 'pendientes' | 'listos';
type EstadoElemento = 'aprobado' | 'parcial' | 'pendiente' | 'cambios' | 'sin_aprobadores';

interface Persona {
	user_id: string; nombre: string; decision: 'aprobado' | 'rechazado' | null;
	comentario: string | null; zona: string | null; momento: string | null; version: string | null;
	anterior?: { comentario: string | null; zona: string | null; version: string | null } | null;
}
export interface Elemento {
	id: number; clave: string; titulo: string; detalle: string | null; viviendas: string | null; orden: number;
	ruta: string; miniatura: string | null; huella: string; vistas: { id: string; nombre: string }[] | null;
	estado: EstadoElemento; requeridos: number; aprobados: number; personas: Persona[];
	heredada_de: string | null; completada_en: string | null;
}

interface UnidadExperiencia {
	clave: string; titulo: string; detalle?: string; viviendas?: string | string[]; orden?: number; huella: string;
	vistas?: { id: string; nombre: string }[];
}
interface ManifiestoExperiencia { promocion: string; version: string; unidades: UnidadExperiencia[] }

export interface Parte {
	tipo: Tipo;
	/** La versión tiene esta parte (enviada o preparada en la vista previa). Si no, no se exige. */
	aplica: boolean;
	elementos: Elemento[];
	lista: Lista;
}
export interface Validacion {
	version: string;
	planos: Parte; experiencia: Parte;
	manifiestoPlanos: Manifiesto | null; manifiestoExperiencia: ManifiestoExperiencia | null;
}

const NOMBRE: Record<Tipo, string> = { planos: 'Planos comerciales', experiencia: 'Experiencia 3D' };
const LOS: Record<Tipo, string> = { planos: 'los planos comerciales', experiencia: 'la Experiencia 3D' };

/** Unidades de Experiencia 3D de la vista previa (null si la versión no las tiene). */
export async function leerExperiencia(revision: string, id: string, version: string): Promise<ManifiestoExperiencia | null> {
	try {
		const r = await fetch(`${revision}/${encodeURIComponent(id)}/experiencia/experiencia.json`, { cache: 'no-store' });
		if (!r.ok) return null;
		const m = await r.json() as ManifiestoExperiencia;
		return m.version === version && Array.isArray(m.unidades) && m.unidades.length ? m : null;
	} catch {
		return null;
	}
}

export async function elementos(id: string, version: string, tipo: Tipo): Promise<Elemento[]> {
	const { data, error } = await sb.rpc('validacion_de_version', { p_promocion: id, p_version: version, p_tipo: tipo });
	if (error) throw error;
	return ((data ?? []) as Elemento[]).map((e) => ({ ...e, personas: e.personas ?? [] }));
}

/** Igual que validacion_lista de la base de datos. */
function lista(els: Elemento[]): Lista {
	if (!els.length) return 'sin_enviar';
	if (els.some((e) => e.estado === 'sin_aprobadores')) return 'sin_aprobadores';
	if (els.some((e) => e.estado === 'cambios')) return 'cambios';
	if (els.some((e) => e.estado !== 'aprobado')) return 'pendientes';
	return 'listos';
}

export async function leerValidacion(revision: string, id: string, version: string): Promise<Validacion> {
	const [manifiestoPlanos, manifiestoExperiencia, planos, experiencia] = await Promise.all([
		leerManifiesto(revision, id, version),
		leerExperiencia(revision, id, version),
		elementos(id, version, 'planos'),
		elementos(id, version, 'experiencia'),
	]);
	const parte = (tipo: Tipo, els: Elemento[], hay: boolean): Parte => ({ tipo, aplica: hay || els.length > 0, elementos: els, lista: lista(els) });
	return {
		version, manifiestoPlanos, manifiestoExperiencia,
		planos: parte('planos', planos, !!manifiestoPlanos),
		experiencia: parte('experiencia', experiencia, !!manifiestoExperiencia),
	};
}

const lasPartes = (v: Validacion) => [v.planos, v.experiencia].filter((p) => p.aplica);
export const listaParaPublicar = (v: Validacion) => lasPartes(v).every((p) => p.lista === 'listos');
export const tieneValidacion = (v: Validacion) => lasPartes(v).length > 0;
const porEnviar = (v: Validacion) => ({
	planos: !!v.manifiestoPlanos && !v.planos.elementos.length,
	experiencia: !!v.manifiestoExperiencia && !v.experiencia.elementos.length,
});

/** Por qué no se puede publicar todavía (vacío si se puede). */
export function motivoNoPublicar(v: Validacion): string {
	// lo más importante primero: cambios pedidos, sin aprobadores, sin enviar, faltan aprobaciones
	const orden: Lista[] = ['cambios', 'sin_aprobadores', 'sin_enviar', 'pendientes'];
	const p = lasPartes(v).filter((x) => x.lista !== 'listos').sort((a, b) => orden.indexOf(a.lista) - orden.indexOf(b.lista))[0];
	if (!p) return '';
	return {
		sin_enviar: 'Primero envía a validar a la promotora.',
		sin_aprobadores: `La promotora todavía no ha designado a nadie para validar ${LOS[p.tipo]}, y sin esa validación no se puede publicar. Lo hace quien la administra, en MUNE Portal (Equipo).`,
		cambios: `La promotora ha pedido cambios en ${LOS[p.tipo]}. Para publicar, hay que corregirlo y preparar una versión nueva: díselo a Claude.`,
		pendientes: `Faltan aprobaciones de ${LOS[p.tipo]}: podrás publicar cuando estén todas.`,
		listos: '',
	}[p.lista];
}

/** Estado de una versión pendiente para la bandeja de Inicio: [etiqueta, clase, explicación, prioridad]. */
export function pasoInicio(v: Validacion): [string, string, string, number] {
	if (!tieneValidacion(v)) return ['Revisar y publicar', 'pendiente', 'Revisa la vista previa y publícala si está bien.', 3];
	if (listaParaPublicar(v)) return ['Lista para publicar', 'al-dia', 'La promotora lo ha validado todo.', 0];
	const partes = lasPartes(v);
	if (partes.some((p) => p.lista === 'cambios')) return ['Cambios pedidos', 'rechazado', 'La promotora ha pedido cambios. Mira cuáles en la promoción.', 1];
	if (partes.some((p) => p.lista === 'sin_enviar')) return ['Enviar a validar', 'pendiente', 'Revisa la vista previa y envíala a validar a la promotora.', 2];
	if (partes.some((p) => p.lista === 'sin_aprobadores')) {
		return ['Sin aprobadores definidos', 'pendiente', 'La promotora tiene que definir en MUNE Portal quién valida. Si hace falta, recuérdaselo.', 4];
	}
	const els = partes.flatMap((p) => p.elementos);
	const hechos = els.filter((e) => e.estado === 'aprobado').length;
	return [`Esperando aprobaciones: ${hechos} de ${els.length}`, '', 'La promotora está validando.', 5];
}

// ── Pintar el bloque «Validación de vN» ─────────────────────────────────────

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

function resumenParte(p: Parte): string {
	if (!p.elementos.length) return '<span class="estado pendiente">Sin enviar</span>';
	if (p.lista === 'sin_aprobadores') return '<span class="estado pendiente">Sin aprobadores definidos</span>';
	const total = p.elementos.length;
	const hechos = p.elementos.filter((e) => e.estado === 'aprobado').length;
	const texto = p.tipo === 'planos'
		? `${hechos} de ${total} ${plural(total, 'aprobado', 'aprobados')}`
		: `${hechos} de ${total} ${plural(total, 'tipología aprobada', 'tipologías aprobadas')}`;
	const cambios = p.elementos.filter((e) => e.estado === 'cambios').length;
	return `${esc(texto)}${p.lista === 'listos' ? ' ✓' : ''}${cambios ? ` · <span class="estado rechazado">${cambios} con cambios pedidos</span>` : ''}`;
}

function chip(e: Elemento, tipo: Tipo): string {
	const f = tipo === 'experiencia';
	switch (e.estado) {
		case 'aprobado': return `<span class="estado al-dia">${e.heredada_de ? `${f ? 'Aprobada' : 'Aprobado'} en la ${esc(e.heredada_de)}` : f ? 'Aprobada' : 'Aprobado'}</span>`;
		case 'parcial': return `<span class="estado pendiente">${f ? 'Parcialmente aprobada' : 'Parcialmente aprobado'}</span>`;
		case 'cambios': return '<span class="estado rechazado">Cambios pedidos</span>';
		case 'sin_aprobadores': return '<span class="estado pendiente">Sin aprobadores</span>';
		default: return '<span class="estado pendiente">Pendiente de validar</span>';
	}
}

function lineaPersona(x: Persona, version: string): string {
	const cuando = x.momento ? ` el ${esc(fecha(x.momento))}` : '';
	const otra = x.version && x.version !== version ? ` (en la ${esc(x.version)})` : '';
	if (x.decision === 'aprobado') return `<li>✓ ${esc(x.nombre)} · aprobó${cuando}${otra}</li>`;
	if (x.decision === 'rechazado') {
		return `<li>✏️ ${esc(x.nombre)} · pidió cambios${cuando}${otra}${x.zona ? ` · ${esc(x.zona)}` : ''}${x.comentario ? `<span class="nota-plano">«${esc(x.comentario)}»</span>` : ''}</li>`;
	}
	const antes = x.anterior ? ` · en la ${esc(x.anterior.version ?? '')} pidió cambios${x.anterior.zona ? ` · ${esc(x.anterior.zona)}` : ''}${x.anterior.comentario ? ` «${esc(x.anterior.comentario)}»` : ''}` : '';
	return `<li class="promo-lugar">${esc(x.nombre)} · pendiente${antes}</li>`;
}

function filaElemento(e: Elemento, tipo: Tipo, version: string, revision: string, id: string): string {
	const avance = e.estado === 'sin_aprobadores' ? '' : `${e.aprobados} de ${e.requeridos} ${plural(e.requeridos, 'aprobación', 'aprobaciones')}`;
	const ver = tipo === 'planos'
		? `<button class="enlace" type="button" data-ver-plano="${esc(e.ruta)}">Ver PDF</button>`
		: `<a class="enlace" href="${esc(`${revision}/${encodeURIComponent(id)}/?ver=${encodeURIComponent(e.clave)}`)}" target="_blank" rel="noopener noreferrer">Ver en la vista previa</a>`;
	return `<div class="fila-plano">
		<span><strong>${esc(tipo === 'experiencia' ? `Experiencia 3D · ${e.titulo}` : e.titulo)}</strong>
			<br><span class="promo-lugar">${esc(e.detalle ?? '')}${e.viviendas ? `${e.detalle ? ' · ' : ''}${esc(e.viviendas)}` : ''}${avance ? `${e.detalle || e.viviendas ? ' · ' : ''}${esc(avance)}` : ''}</span>
			${e.estado === 'aprobado' && e.heredada_de ? `<br><span class="promo-lugar">No ha cambiado desde la ${esc(e.heredada_de)}: conserva su aprobación.</span>` : ''}
			${e.personas.length ? `<ul class="personas-validacion">${e.personas.map((x) => lineaPersona(x, version)).join('')}</ul>` : ''}</span>
		<span class="acciones">${chip(e, tipo)}${ver}</span>
	</div>`;
}

interface Aprobador { user_id: string; nombre: string }

async function aprobadoresDe(id: string, tipo: Tipo): Promise<Aprobador[]> {
	const { data, error } = await sb.rpc('aprobadores_de', { p_promocion: id, p_tipo: tipo });
	if (error) throw error;
	return (data ?? []) as Aprobador[];
}

function bloqueAprobadores(tipo: Tipo, lista: Aprobador[]): string {
	return `<div class="aprobadores" data-aprobadores="${tipo}">
		<p><strong>Quién valida ${esc(LOS[tipo])}:</strong>
			${lista.length ? esc(lista.map((a) => a.nombre).join(', ')) : '<span class="estado pendiente">Sin aprobadores definidos</span>'}
			<button class="enlace" type="button" data-editar-aprobadores="${tipo}">Editar</button></p>
		${lista.length ? '' : `<p class="aviso">Sin aprobadores no se puede validar ${esc(LOS[tipo])}. Lo define quien administra la promoción en MUNE Portal (Equipo); si hace falta, puedes hacerlo tú como soporte.</p>`}
		<form class="peticion-form" data-form-aprobadores="${tipo}" hidden novalidate></form>
	</div>`;
}

/** Formulario para elegir aprobadores (soporte de MUNE): personas con acceso a la promoción. */
async function editarAprobadores(form: HTMLFormElement, id: string, promotora: string, tipo: Tipo, actuales: Aprobador[], alCambiar: () => void): Promise<void> {
	form.hidden = false;
	form.innerHTML = '<p class="vacio">Cargando el equipo…</p>';
	try {
		const accesos = (await leerAccesos(promotora))
			.filter((a) => a.activo && (a.promocion_id === null || a.promocion_id === id))
			.filter((a) => tipo === 'experiencia' || a.administra || a.capacidades.includes('planos'));
		const candidatos = [...new Map(accesos.map((a) => [a.user_id, a])).values()];
		const marcados = new Set(actuales.map((a) => a.user_id));
		form.innerHTML = `
			<p class="ayuda">Normalmente lo decide la promotora en MUNE Portal. Si lo cambias aquí, es como soporte y queda registrado.
				${tipo === 'planos' ? 'Solo aparecen las personas con la capacidad «Planos comerciales» (o que administran).' : 'Aparecen todas las personas con acceso a esta promoción.'}
				Cada elemento queda validado cuando aprueban todas las personas marcadas.</p>
			${candidatos.length ? candidatos.map((a) => `<label class="en-linea"><input type="checkbox" name="persona" value="${esc(a.user_id)}" ${marcados.has(a.user_id) ? 'checked' : ''}>
				${esc(a.nombre)} <span class="promo-lugar">${esc(a.email)}</span></label>`).join('')
				: '<p class="vacio">Nadie del equipo puede validar esto todavía. Da acceso a alguien en «Equipo».</p>'}
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton pequeno" type="submit">Guardar quién valida</button>
				<button class="boton secundario pequeno" type="button" data-cancelar>Cancelar</button>
			</div>`;
		form.querySelector('[data-cancelar]')!.addEventListener('click', () => { form.hidden = true; form.innerHTML = ''; });
		form.onsubmit = async (ev) => {
			ev.preventDefault();
			const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
			const error = form.querySelector<HTMLElement>('.error')!;
			const personas = [...form.querySelectorAll<HTMLInputElement>('input[name=persona]:checked')].map((x) => x.value);
			if (!personas.length && !confirm(`¿Dejar ${LOS[tipo]} sin aprobadores?\n\nSin aprobadores, la promotora no podrá validar y no se podrá publicar.`)) return;
			boton.disabled = true;
			const { error: e } = await sb.rpc('guardar_aprobadores', { p_promocion: id, p_tipo: tipo, p_personas: personas });
			if (e) { error.textContent = traducir(e); boton.disabled = false; return; }
			alCambiar();
		};
	} catch (e) {
		form.innerHTML = `<p class="error">${esc(fallo('No se ha podido cargar el equipo', e))}</p>`;
	}
}

/** Apunta las unidades de Experiencia 3D de la vista previa para que la promotora las valide. */
async function enviarExperiencia(id: string, m: ManifiestoExperiencia): Promise<void> {
	const mal = m.unidades.find((u) => !/^[0-9a-f]{64}$/.test(String(u.huella)) || !u.clave || !u.titulo);
	if (mal) throw new Error(`La Experiencia 3D de la vista previa está incompleta («${mal.titulo ?? mal.clave ?? '?'}»). Hay que volver a preparar la versión: díselo a Claude.`);
	const filas = m.unidades.map((u, i) => ({
		promocion_id: id, version: m.version, tipo: 'experiencia', tipologia: u.clave,
		nombre: `Experiencia 3D · ${u.titulo}`, ruta: `${id}/${m.version}/experiencia/${u.clave}`,
		huella: u.huella, huella_datos: u.huella, clave: u.clave, titulo: u.titulo, detalle: u.detalle ?? null,
		viviendas: Array.isArray(u.viviendas) ? u.viviendas.join(', ') : u.viviendas ?? null,
		orden: u.orden ?? i, vistas: Array.isArray(u.vistas) ? u.vistas : [],
	}));
	const { error } = await sb.from('entregables').insert(filas);
	if (error) throw error;
	await sb.from('promociones').update({ estado: 'en_validacion' }).eq('id', id);
	await anotar('envía la Experiencia 3D a la promotora', { promocion: id, version: m.version, unidades: filas.length });
}

/** Frase que se muestra una vez, al repintar tras enviar a validar. */
let trasEnviar = '';

/**
 * Bloque «Validación de vN» dentro de Versiones: enviar a validar, cómo va cada
 * parte, quién valida y el detalle de cada elemento por persona.
 */
export async function pintarValidacion(caja: HTMLElement, revision: string, p: { id: string; promotora_id: string }, v: Validacion, alCambiar: () => void): Promise<void> {
	const id = p.id;
	if (!tieneValidacion(v)) { caja.innerHTML = ''; return; }
	const [aprobPlanos, aprobExp] = await Promise.all([
		v.planos.aplica ? aprobadoresDe(id, 'planos').catch(() => []) : Promise.resolve([]),
		v.experiencia.aplica ? aprobadoresDe(id, 'experiencia').catch(() => []) : Promise.resolve([]),
	]);
	const aprobadores: Record<Tipo, Aprobador[]> = { planos: aprobPlanos, experiencia: aprobExp };
	const enviar = porEnviar(v);
	const hayQueEnviar = enviar.planos || enviar.experiencia;
	const partes = lasPartes(v);
	const mensaje = trasEnviar;
	trasEnviar = '';

	caja.innerHTML = `
		<h3 class="subtitulo">Validación de ${esc(v.version)}</h3>
		${mensaje ? `<p class="aviso" role="status">${esc(mensaje)}</p>` : ''}
		<table class="resumen-validacion"><tbody>
			${partes.map((x) => {
				const faltan = x.lista === 'pendientes' || x.lista === 'cambios' ? x.elementos.filter((e) => e.estado !== 'aprobado').map((e) => e.titulo) : [];
				return `<tr><th scope="row">${NOMBRE[x.tipo]}</th><td>${resumenParte(x)}${faltan.length
					? `<br><span class="promo-lugar">Pendiente: ${esc(faltan.join(', '))}</span>` : ''}</td></tr>`;
			}).join('')}
		</tbody></table>
		${listaParaPublicar(v) ? '<p class="ok"><strong>Lista para publicar.</strong></p>' : ''}
		${hayQueEnviar ? `
			<p class="ayuda">${enviar.planos ? `MUNE ha preparado ${v.manifiestoPlanos!.planos.length === 1 ? 'un plano comercial' : `${v.manifiestoPlanos!.planos.length} planos comerciales`}` : ''}${enviar.planos && enviar.experiencia ? ' y ' : ''}${enviar.experiencia ? `${enviar.planos ? '' : 'MUNE ha preparado '}la Experiencia 3D de ${v.manifiestoExperiencia!.unidades.length === 1 ? 'una tipología' : `${v.manifiestoExperiencia!.unidades.length} tipologías o variantes`}` : ''}.
				Revisa la vista previa y, si todo está bien, envíalo a validar: la promotora lo verá en MUNE Portal y recibirán un email las personas que tienen que validar. Hasta entonces no lo verá.</p>
			<div class="acciones"><button class="boton" type="button" data-enviar-validar>Enviar a validar a la promotora</button></div>
			<p class="aviso" data-progreso-validar role="status" hidden></p>` : ''}
		${partes.map((x) => bloqueAprobadores(x.tipo, aprobadores[x.tipo])).join('')}
		${partes.filter((x) => x.elementos.length).map((x) => `
			<h4>${x.tipo === 'planos' ? 'Validación de planos comerciales' : 'Validación de Experiencia 3D'}</h4>
			<div class="lista-planos">${x.elementos.map((e) => filaElemento(e, x.tipo, v.version, revision, id)).join('')}</div>`).join('')}`;

	caja.querySelectorAll<HTMLButtonElement>('[data-editar-aprobadores]').forEach((b) => b.addEventListener('click', () => {
		const tipo = b.dataset.editarAprobadores as Tipo;
		const form = caja.querySelector<HTMLFormElement>(`[data-form-aprobadores="${tipo}"]`)!;
		if (!form.hidden) { form.hidden = true; form.innerHTML = ''; return; }
		void editarAprobadores(form, id, p.promotora_id, tipo, aprobadores[tipo], alCambiar);
	}));
	caja.querySelectorAll<HTMLButtonElement>('[data-ver-plano]').forEach((b) => b.addEventListener('click', async () => {
		const ventana = window.open('about:blank', '_blank');
		if (ventana) ventana.opener = null;
		const { data, error } = await sb.storage.from('entregables').createSignedUrl(b.dataset.verPlano!, 300);
		if (error || !data) { ventana?.close(); alert(traducir(error)); return; }
		if (ventana) ventana.location.href = data.signedUrl;
	}));

	const b = caja.querySelector<HTMLButtonElement>('[data-enviar-validar]');
	if (!b) return;
	const aviso = caja.querySelector<HTMLElement>('[data-progreso-validar]')!;
	b.addEventListener('click', async () => {
		const que = [enviar.planos ? 'los planos comerciales' : '', enviar.experiencia ? 'la Experiencia 3D' : ''].filter(Boolean).join(' y ');
		if (!confirm(`¿Enviar a validar ${que} de la ${v.version}?\n\nHazlo después de revisar la vista previa: la promotora lo verá en MUNE Portal para aprobarlo o pedir cambios.`)) return;
		b.disabled = true;
		aviso.hidden = false;
		aviso.classList.remove('error');
		const hecho: string[] = [];
		let fallado: unknown = null;
		try {
			if (enviar.planos) {
				await enviarPlanos(revision, id, v.manifiestoPlanos!, (t) => { aviso.textContent = t; });
				hecho.push('planos');
			}
			if (enviar.experiencia) {
				aviso.textContent = 'Guardando la Experiencia 3D…';
				await enviarExperiencia(id, v.manifiestoExperiencia!);
				hecho.push('experiencia');
			}
		} catch (e) {
			fallado = e;
		}
		const respuestas: [string, string][] = [];
		for (const tipo of hecho) {
			aviso.textContent = 'Avisando a la promotora por email…';
			respuestas.push([tipo === 'planos' ? 'Planos comerciales' : 'Experiencia 3D', await avisarPromotora({ tipo, promocion: id, version: v.version })]);
		}
		// si las dos respuestas son iguales (por ejemplo, el mismo fallo), se dice una vez
		const avisos = new Set(respuestas.map(([, r]) => r)).size === 1 ? [respuestas[0][1]] : respuestas.map(([q, r]) => `${q}: ${r}`);
		if (fallado) {
			aviso.classList.add('error');
			aviso.textContent = `${fallo(hecho.length ? 'Los planos comerciales se han enviado, pero no la Experiencia 3D' : 'No se ha podido enviar a validar', fallado)} ${avisos.join(' ')}`;
			b.disabled = false;
			return;
		}
		const sinExperiencia = hecho.includes('planos') && !v.manifiestoExperiencia && !v.experiencia.elementos.length
			? ' La vista previa no tiene Experiencia 3D de esta versión para validar: se han enviado solo los planos comerciales.' : '';
		trasEnviar = `✓ Enviado a validar: ${hecho.map((t) => (t === 'planos' ? 'planos comerciales' : 'Experiencia 3D')).join(' y ')}.${sinExperiencia} ${avisos.join(' ')}`;
		alCambiar();
	});
}
