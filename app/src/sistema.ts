// Avisos y estado del sistema (Etapa 6, 015_sistema.sql).
//
// · Inicio enseña arriba los avisos (llaves a punto de caducar, espacio casi
//   lleno, vigilancia parada, invitaciones sin aceptar, accesos sin uso).
// · Sistema enseña las llaves con su caducidad («Ya la he renovado»), las
//   copias de seguridad y el simulacro (023_copias.sql), el
//   espacio usado del plan gratuito y la última señal de la vigilancia
//   automática (vigilancia.yml), además del registro de actividad.

import { pintarActividad } from './actividad';
import { esc, fecha, sb, traducir } from './comun';
import { pintarMovil } from './movil';

export interface AvisoSistema { clave: string; nivel: 'alerta' | 'aviso' | 'info'; titulo: string; detalle: string; enlace: string | null }

interface Llave { id: string; nombre: string; para_que: string; donde: string; caduca: string; renovada_en: string | null }
interface Copia { tipo: 'copia' | 'simulacro'; momento: string; correcta: boolean; detalle: { archivos?: number; archivos_nuevos?: number; usuarios?: number } }
interface Estado {
	datos: number; datos_limite: number; archivos: number; archivos_limite: number; latido: string | null; llaves: Llave[];
	copias?: Copia[]; ultima_copia?: string | null; ultimo_simulacro?: { momento: string; correcta: boolean } | null;
}

export async function avisosSistema(): Promise<AvisoSistema[]> {
	const { data, error } = await sb.rpc('avisos_sistema');
	if (error) throw error;
	return (data ?? []) as AvisoSistema[];
}

const ETIQUETA = { alerta: 'Urgente', aviso: 'Pronto', info: 'Para revisar' } as const;

export function pintarAvisos(avisos: AvisoSistema[]): string {
	return `<div class="lista-enlaces">${avisos.map((a) => `
		<a class="fila-enlace aviso-sistema ${a.nivel}" href="${esc(a.enlace ?? '#/sistema')}">
			<span><strong>${esc(a.titulo)}</strong><br><span class="promo-lugar">${esc(a.detalle)}</span></span>
			<span class="estado ${a.nivel === 'alerta' ? 'rechazado' : a.nivel === 'aviso' ? 'pendiente' : ''}">${ETIQUETA[a.nivel]}</span>
		</a>`).join('')}</div>`;
}

const mb = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`
	: n >= 1024 ** 2 ? `${(n / 1024 ** 2).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`
	: n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '0 MB';
const diasHasta = (dia: string) => Math.round((Date.parse(`${dia}T00:00:00`) - Date.parse(`${new Date().toLocaleDateString('sv-SE')}T00:00:00`)) / 86_400_000);

function chipLlave(dias: number): string {
	if (dias < 0) return '<span class="estado rechazado">Caducada</span>';
	const cuando = dias === 0 ? 'Caduca hoy' : `Caduca en ${dias} día${dias === 1 ? '' : 's'}`;
	if (dias <= 30) return `<span class="estado rechazado">${cuando}</span>`;
	if (dias <= 60) return `<span class="estado pendiente">${cuando}</span>`;
	return '<span class="estado al-dia">Vigente</span>';
}

function barra(titulo: string, usado: number, limite: number): string {
	const pc = Math.min(100, Math.round((100 * usado) / limite));
	return `<div class="uso">
		<p><strong>${esc(titulo)}</strong> · ${mb(usado)} de ${mb(limite)} (${pc} %)</p>
		<progress class="${pc >= 95 ? 'lleno' : pc >= 80 ? 'casi' : ''}" max="100" value="${pc}">${pc} %</progress>
	</div>`;
}

const momento = (m: string) => new Date(m).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

function htmlCopias(e: Estado): string {
	const intro = 'Cada noche se guarda una copia cifrada de todo (datos, usuarios y archivos) en el almacén privado «copias» de GitHub, y cada tres meses un simulacro comprueba que se puede recuperar entera.';
	const copias = e.copias ?? [];
	if (!copias.length) {
		return `<p class="ayuda">${intro} Todavía no se ha hecho ninguna: sigue la receta 18 para ponerlas en marcha (o pídele a Claude que te guíe).</p>`;
	}
	const horas = e.ultima_copia ? (Date.now() - Date.parse(e.ultima_copia)) / 3_600_000 : Infinity;
	const sim = e.ultimo_simulacro;
	const ultima = copias.find((c) => c.tipo === 'copia' && c.correcta);
	return `<p class="ayuda">${intro}</p>
		<p>Última copia: ${e.ultima_copia ? `<strong>${esc(momento(e.ultima_copia))}</strong>` : 'ninguna correcta todavía'}
			${horas <= 48 ? '<span class="estado al-dia">Al día</span>' : '<span class="estado rechazado">Falta la de esta noche</span>'}
			${ultima?.detalle.archivos !== undefined ? `<br><span class="promo-lugar">${ultima.detalle.usuarios ?? 0} usuarios y ${ultima.detalle.archivos} archivos guardados${ultima.detalle.archivos_nuevos ? ` (${ultima.detalle.archivos_nuevos} nuevos esa noche)` : ''}.</span>` : ''}</p>
		<p>Último simulacro de recuperación: ${sim ? `<strong>${esc(momento(sim.momento))}</strong>
			${sim.correcta ? '<span class="estado al-dia">Recuperado entero</span>' : '<span class="estado rechazado">Con problemas: díselo a Claude</span>'}` : 'todavía ninguno <span class="estado pendiente">Pendiente</span>'}</p>`;
}

export async function pantallaSistema(destino: HTMLElement): Promise<void> {
	destino.innerHTML = `
		<section class="tarjeta" data-estado-sistema><h2>Estado del sistema</h2><p class="vacio">Cargando…</p></section>
		<section class="tarjeta" data-movil-caja><h2>Código del móvil</h2><p class="vacio">Cargando…</p></section>
		<section class="tarjeta">
			<h2>Registro de actividad completo</h2>
			<p class="ayuda">Todo lo que ha pasado, de todas las promotoras y promociones, y tus entradas en MUNE Studio. Lo de cada promoción también está en su pestaña «Actividad».</p>
			<div data-actividad><p class="vacio">Cargando…</p></div>
		</section>`;
	const caja = destino.querySelector<HTMLElement>('[data-estado-sistema]')!;
	void pintarActividad(destino.querySelector<HTMLElement>('[data-actividad]')!, {}, 100);
	void pintarMovil(destino.querySelector<HTMLElement>('[data-movil-caja]')!);
	await pintarEstado(caja);
}

async function pintarEstado(caja: HTMLElement, mensaje = ''): Promise<void> {
	const { data, error } = await sb.rpc('estado_sistema');
	if (error) {
		caja.innerHTML = `<h2>Estado del sistema</h2><p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const e = data as Estado;
	const horas = e.latido ? (Date.now() - Date.parse(e.latido)) / 3_600_000 : Infinity;
	caja.innerHTML = `
		<h2>Estado del sistema</h2>
		${mensaje ? `<p class="aviso" role="status">${esc(mensaje)}</p>` : ''}
		<h3 class="subtitulo">Llaves</h3>
		<p class="ayuda">Las llaves permiten publicar desde MUNE Studio y llevar la versión publicada a internet. Caducan: 60 y 30 días antes verás un aviso en Inicio y, a 30 días, te llegará también un email. Para renovarlas, sigue la receta 19 (o pide a Claude que te guíe) y después pulsa «Ya la he renovado» para apuntar la nueva fecha.</p>
		<div class="lista-planos">${e.llaves.map((l) => `
			<div class="fila-plano" data-llave="${esc(l.id)}">
				<span><strong>${esc(l.nombre)}</strong><br>
					<span class="promo-lugar">${esc(l.para_que)}. Está en ${esc(l.donde)}.</span><br>
					<span class="promo-lugar">Caduca el ${esc(fecha(l.caduca))}${l.renovada_en ? ` · renovada el ${esc(fecha(l.renovada_en))}` : ''}</span>
					<form class="renovar" data-renovar hidden>
						<label>Nueva fecha de caducidad <input type="date" name="caduca" required></label>
						<button class="boton pequeno" type="submit">Guardar</button>
						<button class="enlace" type="button" data-cancelar>Cancelar</button>
						<span class="error" role="alert"></span>
					</form></span>
				<span class="acciones">${chipLlave(diasHasta(l.caduca))}<button class="enlace" type="button" data-abrir-renovar>Ya la he renovado</button></span>
			</div>`).join('')}</div>
		<h3 class="subtitulo">Espacio del plan gratuito</h3>
		${barra('Base de datos', e.datos, e.datos_limite)}
		${barra('Archivos (documentación, planos y fotos)', e.archivos, e.archivos_limite)}
		<h3 class="subtitulo">Copias de seguridad</h3>
		${ htmlCopias( e ) }
		<h3 class="subtitulo">Vigilancia automática</h3>
		<p class="ayuda">Cada 3 días, una tarea automática (en GitHub) mantiene activa la base de datos (Supabase), para que no se duerma, y comprueba las llaves. Si algo falla, te llega un email.</p>
		<p>${e.latido ? `Última señal: <strong>${esc(new Date(e.latido).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }))}</strong>` : 'Todavía no ha dado ninguna señal.'}
			${horas <= 96 ? '<span class="estado al-dia">Funcionando</span>' : '<span class="estado pendiente">Sin señales recientes</span>'}</p>`;

	caja.querySelectorAll<HTMLElement>('[data-llave]').forEach((fila) => {
		const form = fila.querySelector<HTMLFormElement>('[data-renovar]')!;
		const abrir = fila.querySelector<HTMLButtonElement>('[data-abrir-renovar]')!;
		const input = form.querySelector<HTMLInputElement>('input[name=caduca]')!;
		const hoy = new Date();
		input.min = new Date(hoy.getTime() + 86_400_000).toLocaleDateString('sv-SE');
		input.max = new Date(hoy.getTime() + 400 * 86_400_000).toLocaleDateString('sv-SE');
		abrir.addEventListener('click', () => { form.hidden = false; abrir.hidden = true; input.focus(); });
		form.querySelector('[data-cancelar]')!.addEventListener('click', () => { form.hidden = true; abrir.hidden = false; });
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
			boton.disabled = true;
			const { error: err } = await sb.rpc('renovar_llave', { p_id: fila.dataset.llave, p_caduca: input.value });
			if (err) {
				form.querySelector('.error')!.textContent = traducir(err);
				boton.disabled = false;
				return;
			}
			await pintarEstado(caja, `✓ Guardado: la llave caduca el ${fecha(input.value)}.`);
		});
	});
}
