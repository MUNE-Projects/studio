// Registro de actividad: de una promoción, de una promotora (con sus
// promociones) o completo (Sistema). Solo admite añadir apuntes; aquí solo se lee.

import { esc, sb, traducir } from './comun';
import { nombreCapacidad } from './equipo';

interface Apunte { momento: string; accion: string; user_id: string; detalle: Record<string, unknown> }

/**
 * Textos de las acciones que anota la base de datos por su cuenta, y textos
 * más claros para algunos apuntes de MUNE Studio. Las claves son datos
 * guardados en el registro: no se cambian, solo cómo se leen.
 */
const ACCIONES: Record<string, string> = {
	documento_subido: 'sube un documento',
	documento_vigente: 'acepta un documento',
	documento_rechazado: 'rechaza un documento',
	documento_pendiente: 'vuelve a poner un documento en revisión',
	plano_aprobado: 'aprueba un plano comercial',
	plano_rechazado: 'pide cambios en un plano comercial',
	experiencia_aprobado: 'aprueba una tipología de la Experiencia 3D',
	experiencia_rechazado: 'pide cambios en la Experiencia 3D',
	aprobadores: 'cambia quién valida',
	textos_legales: 'guarda los textos legales',
	fase_proyecto: 'cambia la fase del proyecto',
	modulos: 'cambia las partes de la promoción o su publicación',
	documento_cubre: 'marca qué incluye un archivo',
	acceso_dado: 'da un acceso',
	acceso_cambiado: 'cambia un acceso',
	'da acceso al portal': 'da acceso a MUNE Portal',
	'reenvía acceso al portal': 'reenvía el acceso a MUNE Portal',
	datos_promotora: 'guarda los datos de la promotora',
	datos_promocion: 'guarda los datos fiscales de la promoción',
	ficha_promocion: 'guarda la ficha de la promoción',
	formalizacion_promocion: 'guarda la formalización de la promoción',
	lista_estandar: 'prepara la lista estándar de documentos',
	'entra en el panel': 'entra en MUNE Studio',
	'activa doble verificación': 'activa la verificación con el móvil',
	'abre la publicada': 'abre la versión publicada',
};

export interface FiltroActividad { promocion?: string; promotora?: string; promociones?: string[] }

/** Nombres de quien hace cada apunte (administradoras y personas de las promotoras). */
async function nombres(): Promise<Map<string, string>> {
	const [ad, mi] = await Promise.all([
		sb.from('administradores').select('user_id, nombre'),
		sb.from('miembros').select('user_id, nombre'),
	]);
	const mapa = new Map<string, string>();
	for (const m of (mi.data ?? []) as { user_id: string; nombre: string }[]) mapa.set(m.user_id, m.nombre);
	for (const a of (ad.data ?? []) as { user_id: string; nombre: string }[]) mapa.set(a.user_id, `${a.nombre} (tú)`);
	return mapa;
}

export async function pintarActividad(destino: HTMLElement, filtro: FiltroActividad = {}, limite = 50): Promise<void> {
	let consulta = sb.from('registro').select('momento, accion, user_id, detalle').order('momento', { ascending: false }).limit(limite);
	// Los apuntes llevan la promoción en «promocion» (los más antiguos, en «id»)
	// y la promotora en «promotora».
	const condiciones: string[] = [];
	const promociones = [...(filtro.promociones ?? []), ...(filtro.promocion ? [filtro.promocion] : [])];
	if (promociones.length) {
		const lista = promociones.map((p) => `"${p}"`).join(',');
		condiciones.push(`detalle->>promocion.in.(${lista})`, `detalle->>id.in.(${lista})`);
	}
	if (filtro.promotora) condiciones.push(`detalle->>promotora.eq.${filtro.promotora}`);
	if (condiciones.length) consulta = consulta.or(condiciones.join(','));

	const [{ data, error }, quien] = await Promise.all([consulta, nombres()]);
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	// Los accesos los anota la propia base de datos (acceso_dado, acceso_cambiado),
	// los dé MUNE Studio o la promotora desde MUNE Portal. Cuando la función
	// «invitar» ya ha dejado su apunte («da acceso al portal», con el correo)
	// en el mismo momento, el de la base de datos sobra.
	const todos = (data ?? []) as Apunte[];
	const invitaciones = todos.filter((a) => a.accion === 'da acceso al portal').map((a) => [a.user_id, Date.parse(a.momento)] as const);
	const apuntes = todos.filter((a) => a.accion !== 'acceso_dado'
		|| !invitaciones.some(([u, t]) => u === a.user_id && Math.abs(t - Date.parse(a.momento)) < 60_000));
	if (!apuntes.length) {
		destino.innerHTML = '<p class="vacio">Todavía no hay actividad.</p>';
		return;
	}
	const detalle = (a: Apunte) => {
		const d = a.detalle ?? {};
		const acceso = a.accion.startsWith('acceso_');
		const partes = [
			acceso && typeof d.persona === 'string' ? quien.get(d.persona) ?? null : null,
			acceso && d.promocion === 'todas' ? 'todas las promociones' : null,
			!filtro.promocion && typeof d.promocion === 'string' && d.promocion !== 'todas' ? d.promocion : null,
			acceso && d.activo === false ? 'sin acceso' : null,
			acceso && d.administra === true ? (d.promocion === 'todas' ? 'administrador de la promotora' : 'administrador de promoción') : null,
			acceso && d.administra !== true && Array.isArray(d.capacidades)
				? (d.capacidades.length ? (d.capacidades as string[]).map(nombreCapacidad).join(', ') : 'sin capacidades') : null,
			a.accion === 'aprobadores' && typeof d.tipo === 'string' ? (d.tipo === 'planos' ? 'planos comerciales' : 'Experiencia 3D') : null,
			a.accion === 'aprobadores' && Array.isArray(d.personas)
				? (d.personas.length ? (d.personas as string[]).map((u) => quien.get(u) ?? '—').join(', ') : 'nadie') : null,
			typeof d.zona === 'string' ? `zona: ${d.zona}` : null,
			typeof d.contenido === 'string' ? d.contenido : null,
			typeof d.email === 'string' ? d.email : null,
			typeof d.nombre === 'string' ? d.nombre : null,
			typeof d.version === 'string' ? d.version : null,
			typeof d.motivo === 'string' ? `motivo: ${d.motivo}` : null,
			typeof d.nota === 'string' ? `nota: ${d.nota}` : null,
		].filter(Boolean) as string[];
		return partes.join(' · ');
	};
	destino.innerHTML = `<div class="tabla"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th></tr></thead><tbody>
		${apuntes.map((a) => `<tr>
			<td>${esc(new Date(a.momento).toLocaleString('es-ES'))}</td>
			<td>${esc(quien.get(a.user_id) ?? '—')}</td>
			<td>${esc(ACCIONES[a.accion] ?? a.accion)}${detalle(a) ? `<br><span class="promo-lugar">${esc(detalle(a))}</span>` : ''}</td>
		</tr>`).join('')}
	</tbody></table></div>`;
}
