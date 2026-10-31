// MUNE Portal (espacio de trabajo de las promotoras): pantallas (entrar, inicio, cada promoción).
// Lo común (sesión de Supabase, utilidades) está en comun.ts; quién puede qué, en
// permisos.ts; cada pestaña con lógica propia, en su archivo (documentos.ts,
// planos.ts, experiencia.ts, equipo.ts, compradores.ts).

import { pintarReferencias } from './referencias';
import type { Factor } from '@supabase/supabase-js';
import { textoFase } from './fase';
import { datosFormalizacion, formFormalizacion, type Formalizacion } from './formalizacion';
import { ESCAPARATE, REVISION, INACTIVIDAD_MAX, MIN_CLAVE, CABECERA, alEnviar, app, errorEnlace, esc, fecha, pintar, sb, tipoEnlace, traducir } from './comun';
import { pintarCompradores } from './compradores';
import { pintarPersonalizacion } from './personalizacion';
import { pintarCatalogo } from './catalogo';
import { pintarMarca } from './marca';
import { pintarComparacion } from './comparacion';
import { pendientes, pintarComentarios } from './comentarios';
import { conectarSolicitar, formSolicitar, type DatosSolicitar } from './solicitar';
import { COLUMNAS_DOCUMENTO, COLUMNAS_REQUISITO, type Documento, type Requisito, leerCubre, pintarDocumentacion, resumenDocumentos } from './documentos';
import { pintarEquipo } from './equipo';
import { pintarEstados } from './estado';
import { pintarExperiencia, versionesConExperiencia } from './experiencia';
import { type Miembro, type Permisos, permisosDe } from './permisos';
import { conectarDescargaVigentes, htmlLista, leerPlanos, pintarDetalle, versionesConPlanos } from './planos';
import { type Contexto, type Elemento, depsComentarios, leerValidacion, numVersion, tituloUnidad, versionPublicada } from './validacion';

// ── Decide qué pantalla toca ──────────────────────────────────────────────

async function decidir(): Promise<void> {
	const { data: { session } } = await sb.auth.getSession();
	if (!session) {
		if (errorEnlace) return pantallaEntrada('El enlace del email ha caducado o ya se ha usado. Si es tu primera vez, pide al equipo de MUNE que te reenvíe la invitación; si no, pulsa «¿Has olvidado tu contraseña?».');
		return pantallaEntrada();
	}
	// Invitación: primero la contraseña y después el móvil. Contraseña olvidada:
	// primero el código del móvil (si ya lo tiene) y después la contraseña nueva.
	if (tipoEnlace === 'invite') return pantallaClave('invite');
	if (tipoEnlace === 'recovery') return conMovil(() => pantallaClave('recovery'));
	return conMovil(navegar);
}

// ── Código del móvil (032_movil_promotoras.sql) ───────────────────────────
// Sin él, la base de datos no da nada a la sesión: solo con la contraseña no basta.

const CAMPO_CODIGO = `<label>Código de 6 cifras
	<input class="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
</label>`;

/** Pide el código del móvil (o lo vincula la primera vez) y después sigue. */
async function conMovil(siguiente: () => void | Promise<void>): Promise<void> {
	const { data: nivel, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
	if (error) throw error;
	if (nivel.currentLevel === 'aal2') return siguiente();
	const { data: factores, error: e2 } = await sb.auth.mfa.listFactors();
	if (e2) throw e2;
	const totp = factores.all.filter((f) => f.factor_type === 'totp');
	const verificado = totp.find((f) => f.status === 'verified');
	return verificado ? pantallaCodigo(verificado, siguiente) : pantallaAlta(totp, siguiente);
}

async function pantallaAlta(pendientes: Factor[], siguiente: () => void | Promise<void>): Promise<void> {
	// Un alta a medias (QR que no se llegó a confirmar) impide crear otra.
	for (const f of pendientes) await sb.auth.mfa.unenroll({ factorId: f.id });
	const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Móvil', issuer: 'MUNE Portal' });
	if (error) throw error;
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Protege tu acceso con el móvil</h1>
		<p>Cada vez que entres, además de la contraseña, necesitarás un código del móvil. Así, aunque alguien conociera tu contraseña, no podría entrar. Para activarlo:</p>
		<p>1. Instala en el móvil <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong> (son gratis) y ábrela.<br>
		2. Pulsa <strong>+</strong> y elige <strong>Escanear código QR</strong>.<br>
		3. Escribe aquí el código de 6 cifras que aparece en <strong>MUNE Portal</strong>.</p>
		<div class="qr"><img alt="Código QR para la app de verificación" src="${esc(data.totp.qr_code)}"></div>
		<p class="secreto">¿No puedes escanear el código? Escribe esta clave a mano en la app: ${esc(data.totp.secret)}</p>
		${CAMPO_CODIGO}
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Confirmar</button>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</form>`);
	app.querySelector('[data-salir]')!.addEventListener('click', () => void salir());
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: String(d.get('codigo')).trim() });
		if (error) throw error;
		await siguiente();
	});
}

function pantallaCodigo(factor: Factor, siguiente: () => void | Promise<void>): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Código del móvil</h1>
		<p>Abre la app de verificación del móvil y escribe el código de 6 cifras que aparece en <strong>MUNE Portal</strong>.</p>
		${CAMPO_CODIGO}
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Verificar</button>
		<button class="boton secundario" type="button" data-salir>Salir</button>
		<p class="ayuda">¿Has perdido el móvil o lo has cambiado? Pide a quien administra tu equipo, o al equipo de MUNE, que te quite el código del móvil. Al volver a entrar podrás vincular el nuevo.</p>
	</form>`);
	app.querySelector('[data-salir]')!.addEventListener('click', () => void salir());
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: String(d.get('codigo')).trim() });
		if (error) throw error;
		await siguiente();
	});
}

// ── Entrar ────────────────────────────────────────────────────────────────

function pantallaEntrada(aviso = ''): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Entrar</h1>
		${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
		<label>Correo <input name="correo" type="email" autocomplete="username" required autofocus></label>
		<label>Contraseña <input name="clave" type="password" autocomplete="current-password" required></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Entrar</button>
		<button class="enlace" type="button" data-olvido>¿Has olvidado tu contraseña?</button>
	</form>`);
	app.querySelector('[data-olvido]')!.addEventListener('click', pantallaOlvido);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.signInWithPassword({
			email: String(d.get('correo')).trim(),
			password: String(d.get('clave')),
		});
		if (error) throw error;
		await conMovil(navegar);
	});
}

function pantallaOlvido(): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Contraseña nueva</h1>
		<p>Escribe tu correo. Si tiene acceso a MUNE Portal, te llegará un email con un enlace para elegir una contraseña nueva.</p>
		<label>Correo <input name="correo" type="email" autocomplete="username" required autofocus></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Enviar el enlace</button>
		<button class="enlace" type="button" data-volver>Volver</button>
	</form>`);
	app.querySelector('[data-volver]')!.addEventListener('click', () => pantallaEntrada());
	alEnviar(app.querySelector('form')!, async (d) => {
		const correo = String(d.get('correo')).trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Escribe un correo válido.');
		const { error } = await sb.auth.resetPasswordForEmail(correo, { redirectTo: `${location.origin}/` });
		if (error) throw error;
		pantallaEntrada('Si ese correo tiene acceso, en unos minutos te llegará el email. Revisa también la carpeta de correo no deseado.');
	});
}

// ── Elegir contraseña (invitación o contraseña olvidada) ─────────────────

function pantallaClave(tipo: 'invite' | 'recovery'): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>${tipo === 'invite' ? 'Te damos la bienvenida' : 'Elige una contraseña nueva'}</h1>
		<p>${tipo === 'invite' ? 'Elige la contraseña con la que entrarás en MUNE Portal a partir de ahora. ' : ''}Usa al menos ${MIN_CLAVE} caracteres. Te recomendamos guardarla en un gestor de contraseñas.</p>
		<label>Contraseña <input name="clave" type="password" autocomplete="new-password" minlength="${MIN_CLAVE}" required autofocus></label>
		<label>Repite la contraseña <input name="repetida" type="password" autocomplete="new-password" required></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Guardar y entrar</button>
	</form>`);
	alEnviar(app.querySelector('form')!, async (d) => {
		const clave = String(d.get('clave'));
		if (clave.length < MIN_CLAVE) throw new Error(`La contraseña tiene que tener al menos ${MIN_CLAVE} caracteres.`);
		if (clave !== String(d.get('repetida'))) throw new Error('Las dos contraseñas no coinciden. Escríbelas de nuevo.');
		const { error } = await sb.auth.updateUser({ password: clave });
		if (error) throw error;
		await conMovil(navegar);
	});
}

// ── Navegación: #/ (inicio) y #/promocion/<id> ───────────────────────────

interface DatosFiscales { razon_social: string | null; cif: string | null; domicilio_fiscal: string | null }
interface Promotora extends DatosFiscales { id: string; nombre: string; contacto: string | null }
interface Acceso { yo: string; nombre: string; cargo: string; promotora: Promotora | null; filas: Miembro[] }
let acceso: Acceso | null = null;

/** Lee los accesos de la sesión (uno por «todas las promociones» y/o uno por promoción). */
async function leerAcceso(): Promise<Acceso | null> {
	const { data: { session } } = await sb.auth.getSession();
	if (!session) return null;
	const { data, error } = await sb.from('miembros')
		.select('id, promotora_id, promocion_id, nombre, cargo, administra, capacidades, promotoras(id, nombre, razon_social, cif, domicilio_fiscal, contacto)')
		.eq('user_id', session.user.id).order('promocion_id', { ascending: true, nullsFirst: true });
	if (error) throw error;
	const filas = (data ?? []) as unknown as (Miembro & { promotoras: Promotora | null })[];
	if (!filas.length) return null;
	const primera = filas[0];
	const mias = filas.filter((f) => f.promotora_id === primera.promotora_id);
	return {
		yo: session.user.id, nombre: primera.nombre, cargo: mias.find((f) => f.cargo)?.cargo ?? '',
		promotora: primera.promotoras, filas: mias,
	};
}

async function navegar(): Promise<void> {
	const leido = await leerAcceso();
	if (!leido) {
		acceso = null;
		await sb.auth.signOut();
		pintar(`<div class="caja">${CABECERA}<h1>Sin acceso</h1>
			<p>Esta cuenta no tiene acceso a MUNE Portal ahora mismo. Si crees que es un error, escribe al equipo de MUNE.</p>
			<button class="boton secundario" type="button" data-volver>Volver</button></div>`);
		app.querySelector('[data-volver]')!.addEventListener('click', () => pantallaEntrada());
		return;
	}
	acceso = leido;
	const ruta = location.hash.match(/^#\/promocion\/([a-z0-9-]{1,60})(?:\/([a-z]{1,20})(?:\/([a-z0-9]{1,12}))?)?$/);
	return ruta ? pantallaPromocion(ruta[1], ruta[2], ruta[3] ?? '') : pantallaInicio();
}

addEventListener('hashchange', () => { if (acceso) void navegar().catch(fallo); });

/** Permisos de la sesión: en general (sin promoción) o en una promoción. */
const permisos = (promocion: string | null): Permisos =>
	permisosDe(acceso?.filas ?? [], acceso?.promotora?.id ?? '', promocion);

function cabeceraSesion(enPromocion?: Permisos): string {
	const general = permisos(null);
	const rol = general.esAdminPromotora ? 'Administrador de la promotora'
		: enPromocion?.administraPromocion ? 'Administrador de esta promoción' : '';
	return `<div class="cabecera">
		<div>${CABECERA}<h1>${esc(acceso?.promotora?.nombre ?? '')}</h1>
			<p class="rol">${esc(acceso?.nombre ?? '')}${acceso?.cargo ? ` · ${esc(acceso.cargo)}` : ''}</p>
			${rol ? `<p class="rol rol-admin">${rol}</p>` : ''}</div>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</div>`;
}

/** Formulario de datos fiscales (de la promotora o de una promoción). */
function formFiscal(d: DatosFiscales & { contacto?: string | null }, conContacto: boolean, conCopiar: boolean): string {
	return `<form class="peticion-form" data-fiscal novalidate>
		${conCopiar ? '<button class="boton secundario pequeno" type="button" data-copiar>Copiar los datos de la promotora</button>' : ''}
		<label>Razón social <input name="razon_social" maxlength="200" value="${esc(d.razon_social ?? '')}"></label>
		<label>CIF <input name="cif" maxlength="20" value="${esc(d.cif ?? '')}"></label>
		<label>Domicilio fiscal <input name="domicilio_fiscal" maxlength="300" value="${esc(d.domicilio_fiscal ?? '')}"></label>
		${conContacto ? `<label>Persona de contacto (nombre, correo o teléfono) <input name="contacto" maxlength="300" value="${esc(d.contacto ?? '')}"></label>` : ''}
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar datos</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

function formFicha(p: Ficha): string {
	const num = (n: number | null) => n === null ? '' : String(n);
	return `<form class="peticion-form" data-ficha novalidate>
		<label>Dirección <input name="direccion" maxlength="200" autocomplete="street-address" value="${esc(p.direccion ?? '')}"></label>
		<label>Código postal <input name="codigo_postal" inputmode="numeric" maxlength="5" value="${esc(p.codigo_postal ?? '')}"></label>
		<label>Municipio <input name="municipio" maxlength="120" value="${esc(p.municipio ?? '')}"></label>
		<label>Provincia <input name="provincia" maxlength="120" value="${esc(p.provincia ?? '')}"></label>
		<label>Referencia catastral de la parcela <input name="referencia_catastral" maxlength="40" value="${esc(p.referencia_catastral ?? '')}"></label>
		<label>Tipo <select name="tipo"><option value="">Elige una opción</option>
			<option value="plurifamiliar" ${p.tipo === 'plurifamiliar' ? 'selected' : ''}>Plurifamiliar (edificio de viviendas)</option>
			<option value="unifamiliar" ${p.tipo === 'unifamiliar' ? 'selected' : ''}>Unifamiliar (viviendas independientes)</option></select></label>
		<label>Número de viviendas <input name="num_viviendas" type="number" min="1" max="5000" value="${num(p.num_viviendas)}"></label>
		<label>Número de portales o bloques <input name="num_portales" type="number" min="1" max="500" value="${num(p.num_portales)}"></label>
		<label>Número de plantas <input name="num_plantas" type="number" min="1" max="100" value="${num(p.num_plantas)}"></label>
		<label>Fecha prevista de entrega (opcional) <input name="fecha_entrega" type="date" value="${esc(p.fecha_entrega ?? '')}"></label>
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar ficha</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

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

interface TextosLegales { planos?: string; renders?: string; experiencia?: string; personalizacion?: string }

function formTextosLegales(t: TextosLegales | null | undefined): string {
	const campo = (k: keyof TextosLegales, titulo: string) =>
		`<label>${titulo} <textarea name="${k}" rows="3" maxlength="1000">${esc(t?.[k] ?? '')}</textarea></label>`;
	return `<form class="peticion-form" data-textos-legales novalidate>
		${campo('planos', 'Planos comerciales')}
		${campo('renders', 'Imágenes y renders')}
		${campo('experiencia', 'Experiencia 3D (aparece en pequeño mientras se navega)')}
		${campo('personalizacion', 'Personalización (configurador y documento de selección)')}
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar textos legales</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

/** Conecta un formulario de datos a la función que los guarda y muestra «Guardado». */
function conectarFormulario(selector: string, guardar: (d: FormData) => PromiseLike<{ error: unknown }>, texto = 'Datos guardados.'): HTMLFormElement {
	const form = app.querySelector<HTMLFormElement>(selector)!;
	alEnviar(form, async (d) => {
		form.querySelector<HTMLElement>('[data-guardado]')!.textContent = '';
		const { error } = await guardar(d);
		if (error) throw error;
		form.querySelector<HTMLElement>('[data-guardado]')!.textContent = texto;
		form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
	});
	return form;
}

/** Conecta el formulario de datos fiscales a la función que los guarda. */
function conectarFiscal(guardar: (d: FormData) => PromiseLike<{ error: unknown }>): void {
	const form = conectarFormulario('[data-fiscal]', guardar);
	form.querySelector('[data-copiar]')?.addEventListener('click', () => {
		const po = acceso?.promotora;
		if (!po) return;
		for (const campo of ['razon_social', 'cif', 'domicilio_fiscal'] as const) {
			form.querySelector<HTMLInputElement>(`input[name=${campo}]`)!.value = po[campo] ?? '';
		}
	});
}

// ── Inicio: promociones ───────────────────────────────────────────────────


async function pantallaInicio(): Promise<void> {
	const { data, error } = await sb.from('promociones').select('id, nombre, ubicacion, estado').order('nombre');
	if (error) throw error;
	const lista = data ?? [];
	// Los datos de la empresa solo los gestiona quien administra la promotora.
	const adminPromotora = permisos(null).esAdminPromotora;
	pintar(`<div class="escritorio">
		${cabeceraSesion()}
		<section class="tarjeta">
			<h2>Tus promociones</h2>
			${lista.length ? `<div class="lista-promos">${lista.map((p) => {
				return `<a class="promo-enlace" href="#/promocion/${esc(p.id)}">
					<span><strong>${esc(p.nombre)}</strong><br><span class="promo-lugar">${esc(p.ubicacion)}</span></span>
					<span class="estado" data-estado-promo="${esc(p.id)}">…</span>
				</a>`;
			}).join('')}</div>` : '<p class="vacio">Todavía no hay promociones. Cuando el equipo de MUNE dé de alta la primera, aparecerá aquí.</p>'}
		</section>
		${adminPromotora ? `<section class="tarjeta">
			<h2>Datos de ${esc(acceso?.promotora?.nombre ?? 'la promotora')}</h2>
			<p class="ayuda">Los datos generales de la promotora. Cada promoción puede tener además los suyos, por si la lleva otra sociedad.</p>
			${formFiscal(acceso?.promotora ?? { razon_social: null, cif: null, domicilio_fiscal: null }, true, false)}
		</section>
		<section class="tarjeta" data-marca-general></section>` : ''}
	</div>`);
	pintarEstados(app, sb, ESCAPARATE);
	app.querySelector('[data-salir]')!.addEventListener('click', () => void salir());
	if (adminPromotora) void pintarMarca(app.querySelector<HTMLElement>('[data-marca-general]')!, { sb, esc, fecha, traducir }, { promotora: acceso!.promotora!.id }).catch(fallo);
	if (adminPromotora) conectarFiscal((d) => sb.rpc('guardar_datos_promotora', {
		p_promotora: acceso!.promotora!.id, p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')),
		p_domicilio_fiscal: String(d.get('domicilio_fiscal')), p_contacto: String(d.get('contacto')),
	}).then(async (r) => {
		// Para que «Copiar los datos de la promotora» use los datos recién guardados.
		if (!r.error) acceso = (await leerAcceso()) ?? acceso;
		return r;
	}));
}

// ── Una promoción, por pestañas: #/promocion/<id>/<pestaña>[/<plano o versión>] ─

interface Ficha {
	direccion: string | null; codigo_postal: string | null; municipio: string | null; provincia: string | null;
	referencia_catastral: string | null; tipo: string | null; num_viviendas: number | null; num_portales: number | null;
	num_plantas: number | null; fecha_entrega: string | null; fase_proyecto?: string | null;
}
interface Entregable { id: number; version: string; tipo: string; tipologia: string | null; nombre: string; ruta: string }

const TIPOS_ENTREGABLE: Record<string, string> = { infografia: 'Infografía', pdf: 'PDF' };
/** Pestañas: clave, título y la capacidad que hace falta (null: todo el equipo; 'administra': quien administra). */
const PESTANAS: [string, string, string | null][] = [
	['resumen', 'Resumen', null],
	['documentacion', 'Documentación', 'documentacion'],
	['planos', 'Planos comerciales', 'planos'],
	['experiencia', 'Experiencia 3D', null],
	['compradores', 'Compradores', 'compradores'],
	['personalizacion', 'Personalización', 'personalizacion'],
	['datos', 'Ficha y datos', 'datos'],
	['marca', 'Marca', 'marca'],
	['equipo', 'Equipo', null],
];

/** Elementos pendientes de mi aprobación (para el contador de la pestaña). */
const pendientesMios = (elementos: Elemento[], yo: string) =>
	elementos.filter((e) => e.estado !== 'aprobado' && e.personas.some((x) => x.user_id === yo && x.decision === null)).length;

async function pantallaPromocion(id: string, pestana = 'resumen', extra = '', mensaje = ''): Promise<void> {
	const promo = await sb.from('promociones').select(`id, nombre, ubicacion, estado, promotora_id, razon_social, cif, domicilio_fiscal, direccion, codigo_postal,
		municipio, provincia, referencia_catastral, tipo, num_viviendas, num_portales, num_plantas, fecha_entrega, fase_proyecto, formalizacion, textos_legales, modulos, solicitar_info, solicitar_modo, solicitar_formulario`).eq('id', id).maybeSingle();
	if (promo.error) throw promo.error;
	if (!promo.data) {
		location.hash = '#/';
		return;
	}
	const p = promo.data;
	const yo = acceso!.yo;
	const per = permisosDe(acceso!.filas, p.promotora_id, id);
	const ctx: Contexto = { yo, administraPromocion: per.administraPromocion };
	// Partes que MUNE Studio ha activado en esta promoción (022): sin ellas, su pestaña no aparece.
	const modulos = ((p as unknown as { modulos?: Record<string, boolean> }).modulos ?? {}) as Record<string, boolean>;
	const MODULO_DE: Record<string, string> = { compradores: 'acceso_comprador', personalizacion: 'personalizacion' };
	const visibles = PESTANAS.filter(([k, , c]) => modulos[MODULO_DE[k]] !== false
		&& (c === null || (c === 'administra' ? per.administraPromocion : per.puede(c))));
	const actual = visibles.some(([k]) => k === pestana) ? pestana : 'resumen';

	const [reqs, docs, versionesPlanos, versionesExp] = await Promise.all([
		per.puede('documentacion') ? sb.from('requisitos').select(COLUMNAS_REQUISITO).eq('promocion_id', id).order('orden').order('id') : null,
		per.puede('documentacion') ? sb.from('documentos').select(COLUMNAS_DOCUMENTO).eq('promocion_id', id).order('version', { ascending: false }) : null,
		per.puede('planos') ? versionesConPlanos(id) : Promise.resolve([] as string[]),
		versionesConExperiencia(id),
	]);
	for (const r of [reqs, docs]) if (r?.error) throw r.error;
	const requisitos = (reqs?.data ?? []) as Requisito[];
	const documentos = (docs?.data ?? []) as Documento[];
	const cubre = await leerCubre(documentos);
	// La versión en curso: la más reciente que se ha enviado a validar.
	const enCurso = [versionesPlanos[0], versionesExp[0]].filter(Boolean).sort((a, b) => numVersion(b) - numVersion(a))[0] as string | undefined;
	const [planosCurso, expCurso] = await Promise.all([
		enCurso && versionesPlanos.includes(enCurso) ? leerPlanos(id, enCurso) : Promise.resolve([] as Elemento[]),
		enCurso && versionesExp.includes(enCurso) ? leerValidacion(id, enCurso, 'experiencia') : Promise.resolve([] as Elemento[]),
	]);
	const { faltan, rechazados } = resumenDocumentos(requisitos, documentos, cubre);
	const misPlanos = pendientesMios(planosCurso, yo);
	const miExperiencia = pendientesMios(expCurso, yo);
	const contador: Record<string, string> = {
		documentacion: faltan + rechazados ? `${faltan + rechazados} pendiente${faltan + rechazados === 1 ? '' : 's'}` : '',
		planos: misPlanos ? `${misPlanos} por validar` : '',
		experiencia: miExperiencia ? `${miExperiencia} por validar` : '',
	};

	pintar(`<div class="escritorio">
		${cabeceraSesion(per)}
		<a class="enlace volver" href="#/">← Tus promociones</a>
		<section class="tarjeta">
			<h2>${esc(p.nombre)}</h2>
			<p class="promo-lugar">${esc(p.ubicacion)}${p.ubicacion ? ' · ' : ''}${esc(textoFase((p as unknown as Ficha).fase_proyecto))}</p>
			<nav class="pestanas" aria-label="Secciones de la promoción">${visibles.map(([k, t]) =>
				`<a href="#/promocion/${esc(id)}/${k}" ${k === actual ? 'aria-current="page"' : ''}>${esc(t)}${contador[k] ? `<b class="contador">${esc(contador[k])}</b>` : ''}</a>`).join('')}</nav>
		</section>
		${mensaje ? `<p class="aviso" role="status">${esc(mensaje)}</p>` : ''}
		<section class="tarjeta" data-pestana><p class="cargando">Cargando…</p></section>
	</div>`);
	app.querySelector('[data-salir]')!.addEventListener('click', () => void salir());
	const caja = app.querySelector<HTMLElement>('[data-pestana]')!;

	if (actual === 'resumen') {
		caja.innerHTML = `
			<div class="promo-cabeza"><h2>Resumen</h2><span class="estado" data-estado-promo="${esc(id)}">…</span></div>
			<p class="promo-versiones" data-publicada>Comprobando la versión publicada…</p>
			${htmlValidacionEnCurso(id, enCurso, per.puede('planos') ? planosCurso : null, expCurso)}
			${enCurso ? '<section class="comparacion" data-comparacion hidden></section>' : ''}
			${enCurso ? `<section class="comentarios separado">
				<h3>Comentarios generales de la ${esc(enCurso)}</h3>
				<div data-comentarios-version></div>
			</section>` : ''}
			<div class="lista-promos separado">
				${per.puede('documentacion') ? `<a class="promo-enlace" href="#/promocion/${esc(id)}/documentacion"><span><strong>Documentación</strong><br>
					<span class="promo-lugar">${faltan ? `${faltan === 1 ? 'Falta 1 documento obligatorio' : `Faltan ${faltan} documentos obligatorios`}` : 'Todos los documentos obligatorios entregados'}${rechazados ? ` · ${rechazados} por corregir` : ''}</span></span>
					<span class="estado ${faltan + rechazados ? 'pendiente' : 'al-dia'}">${faltan + rechazados ? 'Pendiente' : 'Al día'}</span></a>` : ''}
				${per.puede('datos') ? `<a class="promo-enlace" href="#/promocion/${esc(id)}/datos"><span><strong>Ficha y datos</strong><br>
					<span class="promo-lugar">Dirección, tipo, viviendas, sociedad y textos legales</span></span></a>` : ''}
				${visibles.some(([k]) => k === 'personalizacion') ? `<a class="promo-enlace" href="#/promocion/${esc(id)}/personalizacion"><span><strong>Personalización</strong><br>
					<span class="promo-lugar">A quién envía el comprador su documento de selección y los datos para la transferencia</span></span></a>` : ''}
			</div>`;
		pintarEstados(caja, sb, ESCAPARATE);
		void pintarPublicada(p.id);
		// qué cambia en la versión en curso respecto a la publicada (comparacion.ts)
		if (enCurso) void pintarComparacion(caja.querySelector<HTMLElement>('[data-comparacion]')!, { sb, esc, traducir, base: REVISION, privado: per.puede('personalizacion') }, id, enCurso);
		// comentarios de toda la versión (los de un plano o una tipología van en su pestaña)
		if (enCurso) void pintarComentarios(caja.querySelector<HTMLElement>('[data-comentarios-version]')!, null, depsComentarios(id),
			{ promocion: id, version: enCurso, tipo: 'version', clave: null, comentar: true });
	}

	if (actual === 'documentacion') {
		await pintarDocumentacion(caja, p, requisitos, documentos, (m) => pantallaPromocion(id, 'documentacion', '', m ?? ''), cubre);
		// la vivienda de referencia de cada tipología, para el entorno del 3D (decisión 66)
		const zonaRef = Object.assign(document.createElement('section'), { className: 'referencias separado' });
		caja.append(zonaRef);
		void pintarReferencias(zonaRef, { sb, esc, traducir, modo: 'promotora' }, id);
	}

	if (actual === 'planos') {
		const alValidar = (m: string) => {
			// vuelve a la lista (y que su enlace al plano funcione aunque sea la misma dirección)
			history.replaceState(null, '', `#/promocion/${id}/planos`);
			void pantallaPromocion(id, 'planos', '', m).catch(fallo);
		};
		if (/^[0-9]{1,12}$/.test(extra)) {
			await pintarDetalle(caja, id, Number(extra), versionesPlanos, ctx, alValidar);
		} else {
			const version = versionesPlanos.includes(extra) ? extra : versionesPlanos[0];
			const { data: otros } = await sb.from('entregables').select('id, version, tipo, tipologia, nombre, ruta')
				.eq('promocion_id', id).not('tipo', 'in', '(plano,experiencia)').order('creado_en', { ascending: false });
			const extras = (otros ?? []) as Entregable[];
			caja.innerHTML = `${version ? await htmlLista(id, version, versionesPlanos, ctx)
				: '<h2>Planos comerciales</h2><p class="vacio">Todavía no hay planos comerciales. El equipo de MUNE los prepara a partir de la documentación que aportas. Cuando estén, los tendrás siempre aquí para consultarlos y descargarlos, y para validarlos cuando haga falta.</p>'}
				${extras.length ? `<h2 class="separado">Otros entregables</h2>${extras.map((e) => `<div class="entregable">
					<span>${esc(TIPOS_ENTREGABLE[e.tipo] ?? e.tipo)} · ${esc(e.version)}<br><span class="promo-lugar">${esc(e.nombre)}</span></span>
					<button class="boton secundario pequeno" type="button" data-bajar="entregables" data-ruta="${esc(e.ruta)}" data-nombre="${esc(e.nombre)}">Descargar</button>
				</div>`).join('')}` : ''}`;
			if (versionesPlanos.length) await conectarDescargaVigentes(caja, id, p.nombre, versionesPlanos);
		}
	}

	if (actual === 'experiencia') {
		await pintarExperiencia(caja, { id, nombre: p.nombre, publicaActiva: modulos.experiencia_publica !== false }, extra, ctx, (m, v) => void pantallaPromocion(id, 'experiencia', v, m).catch(fallo));
	}

	if (actual === 'compradores') {
		await pintarCompradores(caja, { sb, esc, fecha, traducir, escaparate: ESCAPARATE, revision: REVISION, modo: 'promotora' }, p);
	}

	if (actual === 'personalizacion') {
		caja.innerHTML = `
			<div data-selecciones><p class="vacio">Cargando…</p></div>
			<section class="separado" data-catalogo></section>
			<section class="comentarios" data-cambios-personalizacion></section>
			<h2 class="separado">Formalización de la personalización</h2>
			<p class="ayuda">Cuando un comprador termina su personalización, descarga el documento de selección y lo firma. Indica aquí a quién debe enviarlo y, si las mejoras se pagan por transferencia, los datos de la cuenta. Solo lo ven los compradores que entran con su código.</p>
			${formFormalizacion((p as unknown as { formalizacion: Formalizacion }).formalizacion)}`;
		conectarFormulario('[data-formalizacion]', (d) => sb.rpc('guardar_formalizacion', datosFormalizacion(p.id, d)));
		await pintarPersonalizacion(caja.querySelector<HTMLElement>('[data-selecciones]')!, { sb, esc, fecha, traducir, modo: 'promotora' }, p);
		await pintarCatalogo(caja.querySelector<HTMLElement>('[data-catalogo]')!, { sb, esc, fecha, traducir, modo: 'promotora' }, p);
		// cambios de la personalización: comentarios y «Pedir cambios» (separado de la validación de la Experiencia 3D)
		const version = enCurso ?? await versionPublicada(id);
		if (version) await pintarCambiosPersonalizacion(caja.querySelector<HTMLElement>('[data-cambios-personalizacion]')!, id, version);
	}

	if (actual === 'datos') {
		caja.innerHTML = `
			<h2>Ficha de la promoción</h2>
			<p class="ayuda">Los datos básicos del proyecto. La referencia catastral nos ayuda a situar correctamente la parcela y preparar su entorno.</p>
			${formFicha(p as unknown as Ficha)}
			<h2 class="separado">Datos fiscales de la promoción</h2>
			<p class="ayuda">La sociedad que lleva esta promoción. Si es la misma que la de la promotora, pulsa «Copiar los datos de la promotora».</p>
			${formFiscal(p, false, true)}
			<h2 class="separado">Solicitar información</h2>
			<p class="ayuda">La experiencia pública de la promoción enseña un botón «Solicitar información». Elige a dónde lleva: a tu web, a un email o a tu formulario, que se abre encima del 3D. Se aplica al momento.</p>
			${formSolicitar(p as unknown as DatosSolicitar, esc)}
			<h2 class="separado">Textos legales</h2>
			<p class="ayuda">Tus textos legales para cada parte de la promoción, de hasta 1000 caracteres cada uno. Se aplican en la próxima versión que prepare el equipo de MUNE: la revisarás en la vista previa antes de publicarla.</p>
			${formTextosLegales((p as unknown as { textos_legales: TextosLegales | null }).textos_legales)}`;
		conectarFormulario('[data-ficha]', (d) => sb.rpc('guardar_ficha_promocion', datosFicha(p.id, d)));
		conectarFiscal((d) => sb.rpc('guardar_datos_promocion', {
			p_promocion: p.id, p_razon_social: String(d.get('razon_social')), p_cif: String(d.get('cif')), p_domicilio_fiscal: String(d.get('domicilio_fiscal')),
		}));
		conectarSolicitar(caja, sb, p.id, traducir);
		conectarFormulario('[data-textos-legales]', (d) => sb.rpc('guardar_textos_legales', {
			p_promocion: p.id, p_planos: String(d.get('planos') ?? ''), p_renders: String(d.get('renders') ?? ''),
			p_experiencia: String(d.get('experiencia') ?? ''), p_personalizacion: String(d.get('personalizacion') ?? ''),
		}), 'Textos legales guardados. Se aplicarán en la próxima versión.');
	}

	if (actual === 'marca') {
		await pintarMarca(caja, { sb, esc, fecha, traducir }, { promotora: p.promotora_id, promocion: { id: p.id, nombre: p.nombre }, enlaceGeneral: '#/' });
	}

	if (actual === 'equipo') {
		await pintarEquipo(caja, p, per, (m) => pantallaPromocion(id, 'equipo', '', m ?? ''));
		if (extra === 'validan') caja.querySelector('#quien-valida')?.scrollIntoView();
	}

	app.querySelectorAll<HTMLButtonElement>('[data-bajar]').forEach((b) => b.addEventListener('click', () => void descargar(b)));
}

/** Bloque del Resumen: cómo va la validación de la versión en curso. */
function htmlValidacionEnCurso(id: string, version: string | undefined, planos: Elemento[] | null, experiencia: Elemento[]): string {
	if (!version) return '';
	const linea = (titulo: string, href: string, elementos: Elemento[], cuenta: (a: number, t: number) => string) => {
		if (!elementos.length) return `<a class="promo-enlace" href="${href}"><span><strong>${titulo}</strong><br>
			<span class="promo-lugar">Todavía no hay nada que validar en esta versión</span></span></a>`;
		const aprobados = elementos.filter((e) => e.estado === 'aprobado').length;
		const todo = aprobados === elementos.length;
		const sinAprobadores = elementos.some((e) => e.estado === 'sin_aprobadores');
		const cambios = elementos.some((e) => e.estado === 'cambios');
		const pendientes = elementos.filter((e) => e.estado !== 'aprobado').map(tituloUnidad);
		const [chip, clase] = todo ? ['Aprobado', 'al-dia'] : sinAprobadores ? ['Falta elegir quién valida', ''] : cambios ? ['Cambios pedidos', 'rechazado'] : ['Pendiente', 'pendiente'];
		return `<a class="promo-enlace" href="${href}"><span><strong>${titulo}</strong><br>
			<span class="promo-lugar">${cuenta(aprobados, elementos.length)}${todo ? ' ✓' : ''}</span>
			${pendientes.length ? `<br><span class="promo-lugar">Pendiente: ${esc(pendientes.join(', '))}</span>` : ''}</span>
			<span class="estado ${clase}">${chip}</span></a>`;
	};
	const listas = [planos, experiencia].filter((x): x is Elemento[] => !!x);
	const lista = listas.every((x) => x.length && x.every((e) => e.estado === 'aprobado'));
	return `<div class="bloque separado">
		<h3>Validación de la versión en curso · ${esc(version)}</h3>
		<div class="lista-promos">
			${planos ? linea('Planos comerciales', `#/promocion/${esc(id)}/planos`, planos, (a, t) => `${a} de ${t} aprobado${t === 1 ? '' : 's'}`) : ''}
			${linea('Experiencia 3D', `#/promocion/${esc(id)}/experiencia`, experiencia, (a, t) => `${a} de ${t} tipología${t === 1 ? '' : 's'} aprobada${t === 1 ? '' : 's'}`)}
		</div>
		${lista && planos ? `<p class="ok separado">Lista para publicar: todo está validado.</p>` : ''}
	</div>`;
}

async function pintarPublicada(id: string): Promise<void> {
	const destino = app.querySelector<HTMLElement>('[data-publicada]');
	if (!destino) return;
	try {
		const r = await fetch(`${ESCAPARATE}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' });
		if (!r.ok) throw new Error();
		const v = await r.json() as { version: string; fecha: string };
		destino.innerHTML = `Versión publicada: <strong>${esc(v.version)}</strong> · ${esc(fecha(v.fecha))} ·
			<a href="${esc(`${ESCAPARATE}/${id}/`)}" target="_blank" rel="noopener noreferrer">Ver la experiencia publicada</a>`;
	} catch {
		destino.textContent = 'Todavía no hay ninguna versión publicada.';
	}
}

/** Descarga con un enlace temporal (1 minuto) que solo se crea si hay permiso. */
async function descargar(b: HTMLButtonElement): Promise<void> {
	b.disabled = true;
	try {
		const { data, error } = await sb.storage.from(b.dataset.bajar!).createSignedUrl(b.dataset.ruta!, 60, { download: b.dataset.nombre! });
		if (error) throw error;
		const a = document.createElement('a');
		a.href = data.signedUrl;
		a.rel = 'noopener';
		a.click();
	} catch (e) {
		alert(traducir(e, 'descargar el archivo'));
	} finally {
		b.disabled = false;
	}
}

// ── Sesión ────────────────────────────────────────────────────────────────

async function salir(porInactividad = false): Promise<void> {
	acceso = null;
	await sb.auth.signOut();
	history.replaceState(null, '', location.pathname);
	pantallaEntrada(porInactividad ? 'Tu sesión se ha cerrado tras un rato sin actividad. Vuelve a entrar.' : '');
}

let ultimaActividad = Date.now();
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true });
setInterval(async () => {
	if (Date.now() - ultimaActividad < INACTIVIDAD_MAX) return;
	const { data: { session } } = await sb.auth.getSession();
	if (session) await salir(true);
}, 60_000);

function fallo(e: unknown): void {
	pintar(`<div class="caja">${CABECERA}<h1>No se ha podido cargar</h1><p class="error">${esc(traducir(e))}</p>
		<button class="boton" type="button" data-reintentar>Volver a probar</button></div>`);
	app.querySelector('[data-reintentar]')!.addEventListener('click', () => location.reload());
}

decidir().catch(fallo);

/**
 * Cambios de la personalización (038_comentarios.sql): comentarios sobre las
 * opciones, los packs o cómo se ven en el 3D (en modo Personalizar), y «Pedir
 * cambios», que los envía juntos al equipo de MUNE. Va aparte de la validación
 * de la Experiencia 3D.
 */
async function pintarCambiosPersonalizacion(zona: HTMLElement, id: string, version: string): Promise<void> {
	zona.innerHTML = `<h2>Cambios en la personalización</h2>
		<p class="ayuda">Si algo de la personalización no está bien (una opción, un precio en el 3D, cómo se ve un acabado…), coméntalo aquí o en el 3D, en modo Personalizar. Cuando termines, pulsa «Pedir cambios» y se enviará todo junto al equipo de MUNE.</p>
		<div data-hilos></div>
		<div class="acciones"><button class="boton" type="button" data-pedir-cambios hidden></button></div>
		<p class="error" role="alert" data-error-pedir></p>`;
	const pedir = zona.querySelector<HTMLButtonElement>('[data-pedir-cambios]')!;
	const contar = (n: number) => {
		pedir.hidden = !n;
		pedir.textContent = n === 1 ? 'Pedir cambios (1 comentario)' : `Pedir cambios (${n} comentarios)`;
	};
	const hilos = await pintarComentarios(zona.querySelector<HTMLElement>('[data-hilos]')!, null, depsComentarios(id), {
		promocion: id, version, tipo: 'personalizacion', clave: null, comentar: true,
		alCambiar: (hs) => contar(pendientes(hs).length),
	});
	contar(pendientes(hilos).length);
	pedir.addEventListener('click', async () => {
		const error = zona.querySelector<HTMLElement>('[data-error-pedir]')!;
		error.textContent = '';
		if (!confirm('¿Pedir estos cambios de la personalización?\n\nSe enviarán todos los comentarios pendientes al equipo de MUNE, que preparará una versión nueva.')) return;
		pedir.disabled = true;
		const { error: e } = await sb.rpc('pedir_cambios_personalizacion', { p_promocion: id });
		if (e) { error.textContent = traducir(e, 'pedir los cambios'); pedir.disabled = false; return; }
		// aviso por email al equipo de MUNE (si falla, la petición ya está guardada)
		await Promise.race([sb.functions.invoke('aviso-subida', { body: { comentarios: id } }).catch(() => undefined), new Promise((r) => setTimeout(r, 8000))]);
		pedir.disabled = false;
		await pintarCambiosPersonalizacion(zona, id, version);
		zona.insertAdjacentHTML('afterbegin', '<p class="aviso" role="status">Hemos recibido tu petición de cambios de la personalización. El equipo de MUNE preparará una versión nueva.</p>');
	});
}
