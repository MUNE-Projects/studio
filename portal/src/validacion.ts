// MUNE Portal · lo común a la validación de planos comerciales y de la
// Experiencia 3D (020_equipos_y_validaciones.sql).
//
// Cada elemento (un plano, o una tipología o variante en 3D) lo tienen que
// aprobar todas las personas que la promotora ha elegido en «Equipo → Quién
// valida». Si el elemento no cambia de una versión a otra, conserva sus
// aprobaciones.

import { ESCAPARATE, REVISION, esc, sb, traducir } from './comun';
import type { Dependencias, Hilo, TipoComentario } from './comentarios';

export type TipoValidacion = 'planos' | 'experiencia';

export interface Voto {
	user_id: string; nombre: string; decision: 'aprobado' | 'rechazado' | null;
	comentario: string | null; zona: string | null; momento: string | null; version: string | null;
	/** Cambios que pidió en una versión anterior (ya no cuentan: la versión nueva los responde). */
	anterior?: { comentario: string | null; zona: string | null; momento: string | null; version: string | null } | null;
}

export interface Elemento {
	id: number; clave: string; titulo: string; detalle: string | null; viviendas: string | null; orden: number;
	ruta: string; miniatura: string | null; huella: string | null; vistas: { id: string; nombre: string }[] | null;
	estado: 'aprobado' | 'parcial' | 'pendiente' | 'cambios' | 'sin_aprobadores';
	requeridos: number; aprobados: number; personas: Voto[]; heredada_de: string | null; completada_en: string | null;
}

/** Lo que las pantallas de validación necesitan saber de la sesión. */
export interface Contexto { yo: string; administraPromocion: boolean }

export const numVersion = (v: string) => Number(v.slice(1));

export async function leerValidacion(id: string, version: string, tipo: TipoValidacion): Promise<Elemento[]> {
	const { data, error } = await sb.rpc('validacion_de_version', { p_promocion: id, p_version: version, p_tipo: tipo });
	if (error) throw error;
	return ((data ?? []) as Elemento[]).map((e) => ({ ...e, personas: e.personas ?? [] }));
}

/** Versiones con elementos de ese tipo, de la más reciente a la más antigua. */
export async function versionesCon(id: string, tipo: TipoValidacion): Promise<string[]> {
	const { data, error } = await sb.from('entregables').select('version').eq('promocion_id', id).eq('tipo', tipo === 'planos' ? 'plano' : 'experiencia');
	if (error) throw error;
	return [...new Set((data ?? []).map((x) => x.version as string))].sort((a, b) => numVersion(b) - numVersion(a));
}

/** La versión publicada ahora (o null si no hay o no se puede saber). */
export async function versionPublicada(id: string): Promise<string | null> {
	try {
		const r = await fetch(`${ESCAPARATE}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' });
		return r.ok ? ((await r.json()) as { version?: string }).version ?? null : null;
	} catch {
		return null;
	}
}

/** Dónde se ve una versión en 3D: la web publicada si es la versión publicada; si no, la vista previa. */
export async function baseVisita(id: string, version: string): Promise<string> {
	return (await versionPublicada(id)) === version ? ESCAPARATE : REVISION;
}

const ESTADOS: Record<TipoValidacion, Record<Elemento['estado'], [string, string]>> = {
	planos: {
		aprobado: ['Aprobado', 'al-dia'], parcial: ['Parcialmente aprobado', 'pendiente'], pendiente: ['Pendiente de validar', 'pendiente'],
		cambios: ['Cambios pedidos', 'rechazado'], sin_aprobadores: ['Sin aprobadores', ''],
	},
	experiencia: {
		aprobado: ['Aprobada', 'al-dia'], parcial: ['Parcialmente aprobada', 'pendiente'], pendiente: ['Pendiente de validar', 'pendiente'],
		cambios: ['Cambios pedidos', 'rechazado'], sin_aprobadores: ['Sin aprobadores', ''],
	},
};

export function chipEstado(e: Elemento, tipo: TipoValidacion): string {
	const [texto, clase] = ESTADOS[tipo][e.estado] ?? [e.estado, ''];
	return `<span class="estado ${clase}">${esc(texto)}</span>`;
}

const dia = (iso: string) => new Date(iso).toLocaleDateString('es-ES');

/** «{n} de {total} aprobaciones», o de dónde viene la aprobación heredada. */
export function avance(e: Elemento, tipo: TipoValidacion): string {
	if (e.heredada_de) return `${tipo === 'planos' ? 'Aprobado' : 'Aprobada'} en la ${esc(e.heredada_de)}, sin cambios`;
	if (e.estado === 'sin_aprobadores') return '';
	return `${e.aprobados} de ${e.requeridos} aprobaci${e.requeridos === 1 ? 'ón' : 'ones'}`;
}

/** Una línea por persona: quién ha aprobado, quién falta y quién ha pedido cambios. */
export function htmlPersonas(e: Elemento, actual: string): string {
	if (!e.personas.length) return '';
	return `<ul class="votos">${e.personas.map((p) => {
		const otra = p.version && p.version !== actual ? ` (en la ${esc(p.version)})` : '';
		if (p.decision === 'aprobado') {
			return `<li class="voto aprobado"><span class="voto-quien">${esc(p.nombre)}</span> <span class="voto-marca">✓ Aprobado</span>${p.momento ? ` · ${esc(dia(p.momento))}` : ''}${otra}</li>`;
		}
		if (p.decision === 'rechazado') {
			const nota = [p.zona, p.comentario].filter(Boolean).map((x) => esc(x!)).join(' · ');
			return `<li class="voto cambios"><span class="voto-quien">${esc(p.nombre)}</span> <span class="voto-marca">✎ Pide cambios</span>${p.momento ? ` · ${esc(dia(p.momento))}` : ''}${otra}
				${nota ? `<span class="voto-nota">${nota}</span>` : ''}</li>`;
		}
		const antes = p.anterior ? [p.anterior.zona, p.anterior.comentario].filter(Boolean).map((x) => esc(x!)).join(' · ') : '';
		return `<li class="voto"><span class="voto-quien">${esc(p.nombre)}</span> <span class="voto-marca">○ Pendiente de validar</span>
			${p.anterior ? `<span class="voto-antes">En la ${esc(p.anterior.version ?? '')} pidió cambios${antes ? `: «${antes}»` : ''}. Comprueba que están hechos.</span>` : ''}</li>`;
	}).join('')}</ul>`;
}

/** Aviso cuando todavía no hay nadie elegido para validar. */
export function htmlSinAprobadores(id: string, tipo: TipoValidacion, ctx: Contexto): string {
	const que = tipo === 'planos' ? 'los planos comerciales' : 'la Experiencia 3D';
	return `<p class="aviso">Para poder publicar, alguien tiene que validar ${que}, y todavía no hay nadie designado.
		${ctx.administraPromocion ? `<a class="enlace" href="#/promocion/${esc(id)}/equipo/validan">Elegir quién valida</a>`
			: 'Pídeselo a quien administra esta promoción.'}</p>`;
}

/** Mi voto en este elemento, si estoy entre quienes tienen que validarlo. */
export const miVoto = (e: Elemento, ctx: Contexto) => e.personas.find((p) => p.user_id === ctx.yo);

/** Cuántas aprobaciones faltan, contando la mía si ahora apruebo. */
export function faltanTrasAprobar(e: Elemento, ctx: Contexto): number {
	const yaAprobe = miVoto(e, ctx)?.decision === 'aprobado';
	return Math.max(0, e.requeridos - e.aprobados - (yaAprobe ? 0 : 1));
}

/** Guarda la decisión y avisa al equipo de MUNE. Devuelve cómo queda el elemento. */
export async function guardarDecision(id: string, version: string, tipo: TipoValidacion, entregable: number, fila: Record<string, unknown>): Promise<Elemento | undefined> {
	const { data: v, error } = await sb.from('validaciones').insert({ entregable_id: entregable, ...fila }).select('id').single();
	if (error) throw error;
	// aviso por email al equipo de MUNE (si falla, la validación ya está guardada igualmente);
	// si con esta aprobación queda todo validado y la promoción se publica al aprobar, empieza a publicarse
	publicando = '';
	const aviso = sb.functions.invoke('aviso-subida', { body: { validacion_id: v.id } })
		.then(({ data }) => { if ((data as { publicando?: boolean } | null)?.publicando) publicando = version; })
		.catch(() => undefined);
	await Promise.race([aviso, new Promise((r) => setTimeout(r, 8000))]);
	return (await leerValidacion(id, version, tipo)).find((x) => x.id === entregable);
}

/** Versión que se ha empezado a publicar con la última aprobación (o vacío). */
let publicando = '';
export const textoPublicando = () => publicando
	? ` Está todo validado: la ${publicando} se está publicando y estará en la web en unos minutos.` : '';

/** Mensaje tras aprobar: validado del todo o cuántas aprobaciones faltan. */
export function mensajeAprobado(e: Elemento | undefined, tipo: TipoValidacion): string {
	if (!e || e.estado === 'aprobado') return tipo === 'planos' ? 'Plano validado.' : `Experiencia 3D · ${e ? tituloUnidad(e) : ''} validada.`;
	const faltan = Math.max(0, e.requeridos - e.aprobados);
	return `Tu aprobación está registrada. ${faltan === 1 ? 'Falta 1 aprobación' : `Faltan ${faltan} aprobaciones`} para validar ${tipo === 'planos' ? 'el plano' : 'esta parte de la Experiencia 3D'}.`;
}

/** Nombre de una unidad de la Experiencia 3D: la tipología o variante, o el entorno. */
export const tituloUnidad = (e: Pick<Elemento, 'clave' | 'titulo'>) => e.clave === 'entorno' ? 'Entorno y elementos generales' : e.titulo;

/**
 * Abre el 3D en modo profesional: pide un pase a Supabase y lo añade al enlace
 * (#p-…), que la web quita de la dirección al entrar. La pestaña se abre antes
 * de pedirlo para que el navegador no la bloquee.
 */
export async function abrirConPase(id: string, url: string, alFallar: (mensaje: string) => void): Promise<void> {
	const ventana = window.open('', '_blank');
	if (ventana) {
		ventana.opener = null;
		ventana.document.title = 'Abriendo la Experiencia 3D…';
	}
	const { data, error } = await sb.rpc('abrir_experiencia_profesional', { p_promocion: id });
	if (error || typeof data !== 'string') {
		ventana?.close();
		alFallar(traducir(error, 'abrir la Experiencia 3D'));
		return;
	}
	const destino = `${url.split('#')[0]}#p-${data}`;
	if (ventana) ventana.location.href = destino;
	else location.href = destino;
}

// ─── Comentarios visuales (comentarios.ts) ─────────────────────────────────

/** Lo que necesitan los comentarios en MUNE Portal. */
export function depsComentarios(id: string, alFallar: (mensaje: string) => void = (m) => alert(m)): Dependencias {
	return {
		sb, esc, traducir: (e) => traducir(e, 'guardar el comentario'), admin: false,
		// el 3D de la versión más reciente con Experiencia 3D: la vista previa si está en revisión
		abrir3D: (clave: string | null, h: Hilo | null, tipo: TipoComentario) => void (async () => {
			const versiones = await versionesCon(id, 'experiencia');
			const base = versiones[0] ? await baseVisita(id, versiones[0]) : ESCAPARATE;
			const q = new URLSearchParams();
			if (clave) q.set('ver', clave);
			if (tipo === 'personalizacion') q.set('modo', 'personalizar');
			if (h) q.set('comentario', String(h.id)); else q.set('comentar', '1');
			await abrirConPase(id, `${base}/${id}/?${q}`, alFallar);
		})(),
		imagenPlano: async (clave: string, version: string) => {
			const { data } = await sb.from('entregables').select('miniatura').eq('promocion_id', id).eq('tipo', 'plano')
				.eq('version', version).eq('clave', clave).maybeSingle();
			if (!data?.miniatura) return null;
			const { data: u } = await sb.storage.from('entregables').createSignedUrl(data.miniatura as string, 600);
			return u?.signedUrl ?? null;
		},
	};
}
