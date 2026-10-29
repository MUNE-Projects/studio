// Descarga una copia de seguridad de MUNE (receta 18) del almacén de copias
// (releases de MUNE-Projects/copias, github.mjs) a una carpeta, tal como la
// espera restaurar.mjs:
//   base-de-datos/AAAA-MM-DD.tar.gz.gpg   la copia de la base de datos
//   archivos/indice.json                  el índice de archivos de esa copia (descifrado)
//   archivos/<almacén>/<nombre>.gpg       cada archivo, cifrado
//
// Uso: node supabase/copias/bajar.mjs [--fecha AAAA-MM-DD]   (sin fecha: la última)
// Variables: COPIAS_REPO, COPIAS_TOKEN, COPIAS_CIFRADO y COPIAS (carpeta de destino)

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { carpetaTemporal, descifrar, falta } from './comun.mjs';
import { almacenCopias, fechaDe } from './github.mjs';

falta( 'COPIAS_REPO', 'COPIAS_TOKEN', 'COPIAS_CIFRADO', 'COPIAS' );
const { values: op } = parseArgs( { options: { fecha: { type: 'string' } } } );
const { COPIAS, COPIAS_CIFRADO } = process.env;
const almacen = almacenCopias( process.env.COPIAS_REPO, process.env.COPIAS_TOKEN );
const tmp = carpetaTemporal();

const copias = await almacen.lista();
const bd = copias.filter( ( c ) => c.name.startsWith( 'bd-' ) && ( ! op.fecha || fechaDe( c.name ) === op.fecha ) ).at( -1 );
if ( ! bd ) throw new Error( op.fecha ? `No hay copia de la base de datos del ${ op.fecha }` : 'No hay ninguna copia de la base de datos' );

mkdirSync( join( COPIAS, 'base-de-datos' ), { recursive: true } );
writeFileSync( join( COPIAS, 'base-de-datos', `${ fechaDe( bd.name ) }.tar.gz.gpg` ), await almacen.bajar( bd, 'datos.tar.gz.gpg' ) );
mkdirSync( join( COPIAS, 'archivos' ), { recursive: true } );
writeFileSync( join( COPIAS, 'archivos', 'indice.json' ), descifrar( await almacen.bajar( bd, 'indice.json.gpg' ), COPIAS_CIFRADO, tmp ) );

// Los archivos pueden estar en cualquier paquete (también en uno rehecho
// después de esta copia): se bajan todos.
let paquetes = 0;
for ( const c of copias.filter( ( x ) => x.name.startsWith( 'archivos-' ) ) ) {

	execFileSync( 'tar', [ '-xf', '-', '-C', COPIAS ], { input: descifrar( await almacen.bajar( c, 'archivos.tar.gpg' ), COPIAS_CIFRADO, tmp ), maxBuffer: 1 << 30 } );
	paquetes ++;

}
console.log( `Copia ${ bd.name } descargada, con ${ paquetes } paquetes de archivos.` );
