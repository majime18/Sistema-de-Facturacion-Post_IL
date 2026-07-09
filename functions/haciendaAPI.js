'use strict';
const axios = require('axios');

const URLS = {
  stag: {
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    recepcion: 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion',
    consulta: 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion/',
  },
  prod: {
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    recepcion: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion',
    consulta: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion/',
  }
};

async function obtenerToken({ usuario, password, ambiente='prod' }) {
  const params = new URLSearchParams({ client_id:'api-prod', client_secret:'', grant_type:'password', username:usuario, password });
  try {
    const resp = await axios.post(URLS[ambiente].token, params.toString(), { headers:{'Content-Type':'application/x-www-form-urlencoded'}, timeout:15000 });
    return resp.data.access_token;
  } catch(e) {
    const msg = e.response?.data?.error_description || e.message;
    if (msg.includes('Invalid user credentials')) throw new Error('Usuario o contraseña incorrectos en Hacienda');
    throw new Error('Error obteniendo token: ' + msg);
  }
}

async function enviarComprobante({ xmlFirmadoBase64, clave, fecha, emisorTipo, emisorCedula, receptorTipo, receptorCedula, token, ambiente='prod' }) {
  const body = {
    clave, fecha,
    emisor: { tipoIdentificacion:emisorTipo, numeroIdentificacion:emisorCedula },
    receptor: receptorCedula ? { tipoIdentificacion:receptorTipo||'01', numeroIdentificacion:receptorCedula } : undefined,
    comprobanteXml: xmlFirmadoBase64,
  };
  try {
    const resp = await axios.post(URLS[ambiente].recepcion, body, { headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}, timeout:30000 });
    return { enviado:true, estado:'procesando', httpStatus:resp.status };
  } catch(e) {
    const status = e.response?.status;
    if (status===409) return { enviado:true, estado:'duplicado' };
    if (status===400) throw new Error('XML inválido: ' + JSON.stringify(e.response?.data) + ' body:' + JSON.stringify(e.response?.data).substring(0,500));
    throw new Error('Error enviando a Hacienda: ' + (e.response?.data?.message || e.message));
  }
}

async function consultarEstado({ clave, token, ambiente='prod' }) {
  try {
    const resp = await axios.get(URLS[ambiente].consulta + clave, { headers:{'Authorization':`Bearer ${token}`}, timeout:15000 });
    console.log("HACIENDA RESPUESTA:", JSON.stringify(resp.data)); return { clave:resp.data.clave, estado:resp.data['ind-estado'], xmlRespuesta:resp.data.respuesta_xml };
  } catch(e) {
    if (e.response?.status===404) return { estado:'no_encontrado' };
    throw new Error('Error consultando estado: ' + e.message);
  }
}

async function esperarRespuesta({ clave, token, ambiente='prod', maxIntentos=10, intervaloMs=10000 }) {
  for (let i=0; i<maxIntentos; i++) {
    await new Promise(r => setTimeout(r, intervaloMs));
    const estado = await consultarEstado({ clave, token, ambiente });
    if (estado.estado==='aceptado' || estado.estado==='rechazado') return estado;
  }
  return { estado:'procesando', mensaje:'Hacienda procesando, se actualizará automáticamente' };
}

module.exports = { obtenerToken, enviarComprobante, consultarEstado, esperarRespuesta };
