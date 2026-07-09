// Test de la clave
const moment = require('moment-timezone');

function generarClave({ pais='506', fecha, cedulaEmisor, consecutivo, tipoDoc='01', situacion='1' }) {
  const d = moment(fecha).tz('America/Costa_Rica');
  const dia   = d.format('DD');
  const mes   = d.format('MM');
  const anio  = d.format('YY');
  const cedula = cedulaEmisor.padStart(20,'0');
  const consec = consecutivo.toString().padStart(10,'0');
  const seg = Math.floor(Math.random()*99999999).toString().padStart(8,'0');
  const clave = `${pais}${dia}${mes}${anio}${cedula}${consec}${tipoDoc}${situacion}${seg}`;
  console.log('Clave generada:', clave, 'longitud:', clave.length);
  console.log('Partes:', {pais, dia, mes, anio, cedula:`(${cedula.length})`, consec:`(${consec.length})`, tipoDoc, situacion, seg:`(${seg.length})`});
  return clave;
}

// Test
const clave = generarClave({
  cedulaEmisor: '503570258',
  consecutivo: 1,
  fecha: new Date(),
  tipoDoc: '01'
});
console.log('Total esperado: 50, obtenido:', clave.length);
