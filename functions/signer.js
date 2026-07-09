'use strict';
const { DOMParser, XMLSerializer } = require('xmldom');

global.DOMParser = DOMParser;
global.XMLSerializer = XMLSerializer;

// NO sobreescribir global.crypto en Node 24
// haciendacostarica-signer usa Web Crypto nativo de Node 24

const HaciendaSigner = require('haciendacostarica-signer');

async function firmarXML(xml, p12Buffer, pin) {
  try {
    const p12Base64 = p12Buffer.toString('base64');
    const xmlFirmadoBase64 = await HaciendaSigner.sign(xml, p12Base64, pin);
    return xmlFirmadoBase64;
  } catch(e) {
    console.error('Error firma:', e.message);
    throw new Error('Error firmando XML: ' + e.message);
  }
}

async function verificarP12(p12Buffer, pin) {
  try {
    const p12Base64 = p12Buffer.toString('base64');
    const resultado = await HaciendaSigner.verifySignature(p12Base64, pin);
    return { valido: true, resultado };
  } catch(e) {
    return { valido: false, error: e.message };
  }
}

module.exports = { firmarXML, verificarP12 };
