'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
admin.initializeApp();
setGlobalOptions({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 });
const { generarXML, generarClave, generarConsecutivo, calcularTotales } = require('./xmlBuilder');
const { firmarXML, verificarP12: verificarLlave } = require('./signer');
const { obtenerToken, enviarComprobante, esperarRespuesta, consultarEstado } = require('./haciendaAPI');
const { generarPDF } = require('./pdfGenerator');
const nodemailer = require('nodemailer');
const db = admin.firestore();
const storage = admin.storage();
function getEmailConfig() { return { user: process.env.EMAIL_USER||'facturacion.posil@gmail.com', pass: process.env.EMAIL_PASS||'rztladxfgoaiavly' }; }
function getTransporter() { const cfg=getEmailConfig(); return nodemailer.createTransport({ service:'gmail', auth:{ user:cfg.user, pass:cfg.pass } }); }
exports.emitirFactura = onCall({ enforceAppCheck:false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
  const { ventaId, items, tc, receptor, medioPago, tipoDoc='01' } = request.data;
  try {
    const cfgSnap = await db.collection('config').doc('main').get();
    if (!cfgSnap.exists) throw new Error('No hay configuración del sistema');
    const cfg = cfgSnap.data();
    if (!cfg.cedulaEmisor) throw new Error('Falta cédula del emisor en Ajustes');
    if (!cfg.correoEmisor) throw new Error('Falta correo del emisor en Ajustes');
    if (!cfg.codigoActividad) throw new Error('Falta código de actividad en Ajustes');
    if (!cfg.usuarioHacienda) throw new Error('Falta usuario de Hacienda en Ajustes');
    if (!cfg.passwordHacienda) throw new Error('Falta contraseña de Hacienda en Ajustes');
    if (!cfg.pinLlave) throw new Error('Falta PIN de la llave en Ajustes');
    const ambiente = cfg.ambienteFE||'stag';
    const contRef = db.collection('config').doc('consecutivo');
    const nuevoNum = await db.runTransaction(async t => {
      const snap = await t.get(contRef);
      const nuevo = (snap.exists?(snap.data().numero||0):0)+1;
      t.set(contRef,{ numero:nuevo, updatedAt:admin.firestore.FieldValue.serverTimestamp() });
      return nuevo;
    });
    const fecha = new Date();
    const consecutivo = generarConsecutivo({ tipoDoc, numero:nuevoNum });
    const clave = generarClave({ cedulaEmisor:cfg.cedulaEmisor, consecutivoCompleto:consecutivo, fecha });
    const { lineas, totalServGravados, totalMercGravadas, totalGravado, totalExento, totalImpuesto, totalDescuento, totalVenta, totalComprobante } = calcularTotales(items, tc);
    const medioCodigos = { 'Efectivo':['01'],'Tarjeta':['02'],'Sinpe':['04'],'Mixto':['01','02'] };
    const medioHacienda = medioCodigos[medioPago]||['01'];
    const emisor = { nombre:cfg.storeName||cfg.nombreEmisor, cedula:cfg.cedulaEmisor, tipoId:cfg.tipoIdEmisor||cfg.tipoIdentificacion||'01', correo:cfg.correoEmisor, codigoActividad:(cfg.codigoActividad||"").replace(",",""), nombreComercial:cfg.nombreComercial||cfg.storeName, provincia:cfg.provincia||'5', canton:cfg.canton||'03', distrito:cfg.distrito||'01', direccion:cfg.address||'Guanacaste, Costa Rica', telefono:cfg.phone||'' };
    console.log("DEBUG: items recibidos:", JSON.stringify(items?.length), "emisor:", emisor.cedula, "actividad:", emisor.codigoActividad); const xmlSinFirmar = generarXML({ clave, consecutivo, fecha, emisor, receptor, items:lineas, totalServGravados, totalMercGravadas, totalGravado, totalExento, totalImpuesto, totalDescuento, totalVenta, totalComprobante, condicionVenta:'01', medioPago:medioHacienda, tipoDoc });
    const p12Ref = storage.bucket().file(`llaves/${cfg.cedulaEmisor}/llave.p12`);
    const [p12Buffer] = await p12Ref.download();
    const xmlFirmadoBase64 = await firmarXML(xmlSinFirmar, p12Buffer, cfg.pinLlave); console.log("XML FIRMADO inicio:", Buffer.from(xmlFirmadoBase64,"base64").toString("utf8").substring(0,300));
    const token = await obtenerToken({ usuario:cfg.usuarioHacienda, password:cfg.passwordHacienda, ambiente });
    await enviarComprobante({ xmlFirmadoBase64, clave, fecha:fecha.toISOString(), emisorTipo:emisor.tipoId, emisorCedula:emisor.cedula, receptorTipo:receptor?.tipoId, receptorCedula:receptor?.cedula, token, ambiente });
    const feData = { clave, consecutivo, fecha, ventaId, emisor, receptor, items:lineas, totalGravado, totalExento, totalImpuesto, totalDescuento, totalVenta, totalComprobante, medioPago:medioHacienda, tipoDoc, ambiente, estado:'procesando', xmlBase64:xmlFirmadoBase64, createdAt:admin.firestore.FieldValue.serverTimestamp(), createdBy:request.auth.uid };
    const feRef = await db.collection('facturas').add(feData);
    if (ventaId) await db.collection('sales').doc(ventaId).update({ facturaId:feRef.id, facturaClave:clave, facturaConsecutivo:consecutivo, facturaEstado:'procesando' });
    const respuesta = await esperarRespuesta({ clave, token, ambiente });
    await feRef.update({ estado:respuesta.estado, updatedAt:admin.firestore.FieldValue.serverTimestamp() });
    if (ventaId) await db.collection('sales').doc(ventaId).update({ facturaEstado:respuesta.estado });
    if (respuesta.estado==='aceptado') {
      const pdfBuffer = await generarPDF({ clave, consecutivo, fecha, emisor, receptor, items:lineas, totalGravado, totalExento, totalImpuesto, totalDescuento, totalComprobante, condicionVenta:'01', medioPago:medioHacienda, estado:'aceptado', tipoDoc });
      const pdfPath = `facturas/${feRef.id}/factura.pdf`;
      await storage.bucket().file(pdfPath).save(pdfBuffer,{ contentType:'application/pdf' });
      await feRef.update({ pdfPath });
      const correoDestino = receptor?.correo||receptor?.correo2;
      if (correoDestino) {
        await getTransporter().sendMail({ from:`"${emisor.nombre}" <${getEmailConfig().user}>`, to:correoDestino, subject:`Factura Electrónica ${consecutivo} — ${emisor.nombre}`, html:`<div style="font-family:Arial,sans-serif"><div style="background:#6366f1;padding:20px;text-align:center"><h1 style="color:#fff;margin:0">Factura Electrónica</h1></div><div style="padding:24px"><p>Estimado cliente, adjunto su factura aceptada por Hacienda.</p><p><b>N°:</b> ${consecutivo}<br><b>Total:</b> ₡#8353;${Math.round(totalComprobante).toLocaleString('es-CR')}</p></div><div style="background:#6366f1;padding:10px;text-align:center"><p style="color:#fff;font-size:11px;margin:0">POS_IL · Sistemas03il · posilcr.online</p></div></div>`, attachments:[{ filename:`Factura_${consecutivo}.pdf`, content:pdfBuffer, contentType:'application/pdf' },{ filename:`Factura_${consecutivo}.xml`, content:Buffer.from(xmlFirmadoBase64,'base64'), contentType:'application/xml' }] });
      }
    }
    return { ok:true, facturaId:feRef.id, clave, consecutivo, estado:respuesta.estado, mensaje:respuesta.estado==='aceptado'?'Factura aceptada ✓':respuesta.estado==='rechazado'?'Rechazada: '+(respuesta.mensaje||''):'Enviada, procesando...' };
  } catch(e) { console.error('Error:', e); throw new HttpsError('internal', e.message); }
});
exports.consultarFactura = onCall({ enforceAppCheck:false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
  const snap = await db.collection('facturas').doc(request.data.facturaId).get();
  if (!snap.exists) throw new HttpsError('not-found','Factura no encontrada');
  const fe = snap.data();
  if (fe.estado==='procesando') {
    try {
      const cfg = (await db.collection('config').doc('main').get()).data();
      const token = await obtenerToken({ usuario:cfg.usuarioHacienda, password:cfg.passwordHacienda, ambiente:fe.ambiente });
      const resp = await consultarEstado({ clave:fe.clave, token, ambiente:fe.ambiente });
      if (resp.estado==='aceptado'||resp.estado==='rechazado') await snap.ref.update({ estado:resp.estado, updatedAt:admin.firestore.FieldValue.serverTimestamp() });
      return { estado:resp.estado, consecutivo:fe.consecutivo };
    } catch(e) { /* silencioso */ }
  }
  return { estado:fe.estado, consecutivo:fe.consecutivo, clave:fe.clave };
});
exports.reenviarFactura = onCall({ enforceAppCheck:false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
  const { facturaId, correo } = request.data;
  const snap = await db.collection('facturas').doc(facturaId).get();
  if (!snap.exists) throw new HttpsError('not-found','Factura no encontrada');
  const fe = snap.data();
  let pdfBuffer;
  if (fe.pdfPath) { [pdfBuffer] = await storage.bucket().file(fe.pdfPath).download(); }
  else { pdfBuffer = await generarPDF({...fe, estado:fe.estado}); }
  const dest = correo||fe.receptor?.correo;
  await getTransporter().sendMail({ from:`"${fe.emisor?.nombre}" <${getEmailConfig().user}>`, to:dest, subject:`Factura Electrónica ${fe.consecutivo}`, html:`<p>Adjunto factura ${fe.consecutivo}. Total: ₡#8353;${Math.round(fe.totalComprobante).toLocaleString('es-CR')}</p><p>POS_IL · Sistemas03il</p>`, attachments:[{ filename:`Factura_${fe.consecutivo}.pdf`, content:pdfBuffer, contentType:'application/pdf' }] });
  return { ok:true, mensaje:`Factura enviada a ${dest}` };
});
exports.verificarP12 = onCall({ enforceAppCheck:false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
  return verificarLlave(Buffer.from(request.data.p12Base64,'base64'), request.data.pin);
});
exports.verificarFacturasPendientes = onSchedule('every 5 minutes', async () => {
  const cfgSnap = await db.collection('config').doc('main').get();
  if (!cfgSnap.exists) return;
  const cfg = cfgSnap.data();
  if (!cfg.usuarioHacienda) return;
  const pendientes = await db.collection('facturas').where('estado','==','procesando').orderBy('createdAt','asc').limit(20).get();
  if (pendientes.empty) return;
  try {
    const token = await obtenerToken({ usuario:cfg.usuarioHacienda, password:cfg.passwordHacienda, ambiente:cfg.ambienteFE||'stag' });
    for (const docSnap of pendientes.docs) {
      const fe = docSnap.data();
      const resp = await consultarEstado({ clave:fe.clave, token, ambiente:fe.ambiente });
      if (resp.estado==='aceptado'||resp.estado==='rechazado') {
        await docSnap.ref.update({ estado:resp.estado, updatedAt:admin.firestore.FieldValue.serverTimestamp() });
        if (fe.ventaId) await db.collection('sales').doc(fe.ventaId).update({ facturaEstado:resp.estado });
      }
    }
  } catch(e) { console.error('Error pendientes:', e); }
});
// secrets configurados

exports.emitirNotaCredito = onCall({ enforceAppCheck:false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
  const { ventaId, motivo, tipo, montoNC } = request.data;
  try {
    const ventaSnap = await db.collection('sales').doc(ventaId).get();
    if (!ventaSnap.exists) throw new Error('Venta no encontrada');
    const venta = ventaSnap.data();
    if (!venta.facturaId) throw new Error('Esta venta no tiene factura electrónica');
    const feSnap = await db.collection('facturas').doc(venta.facturaId).get();
    if (!feSnap.exists) throw new Error('Factura no encontrada');
    const fe = feSnap.data();
    if (fe.estado!=='aceptado') throw new Error('Solo se puede hacer NC de facturas aceptadas');
    const cfgSnap = await db.collection('config').doc('main').get();
    const cfg = cfgSnap.data();
    const ambiente = cfg.ambienteFE||'stag';
    const fecha = new Date();
    const contRef = db.collection('config').doc('consecutivoNC');
    const nuevoNum = await db.runTransaction(async t => {
      const snap = await t.get(contRef);
      const nuevo = (snap.exists?(snap.data().numero||0):0)+1;
      t.set(contRef,{numero:nuevo,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      return nuevo;
    });
    const dia=String(fecha.getDate()).padStart(2,'0');
    const mes=String(fecha.getMonth()+1).padStart(2,'0');
    const anio=String(fecha.getFullYear()).slice(-2);
    const cedula=cfg.cedulaEmisor.padStart(12,'0');
    const seg=Math.floor(Math.random()*99999999).toString().padStart(8,'0');
    const clave=`506${dia}${mes}${anio}${cedula}${nuevoNum.toString().padStart(10,'0')}05${seg}`;
    const consecutivo=`001000010500${nuevoNum.toString().padStart(10,'0')}`;
    const emisor={nombre:fe.emisor.nombre,cedula:cfg.cedulaEmisor,tipoId:cfg.tipoIdEmisor||cfg.tipoIdentificacion||'01',correo:cfg.correoEmisor,codigoActividad:(cfg.codigoActividad||"").replace(",",""),provincia:cfg.provincia||'5',canton:cfg.canton||'03',distrito:cfg.distrito||'01',direccion:cfg.address||'Guanacaste'};
    let itemsNC,totalGravado,totalImpuesto,totalVenta,totalComprobante;
    if (tipo==='total') {
      itemsNC=fe.items||[];totalGravado=fe.totalGravado||0;totalImpuesto=fe.totalImpuesto||0;totalVenta=fe.totalVenta||0;totalComprobante=fe.totalComprobante||0;
    } else {
      const pct=montoNC/fe.totalComprobante;
      itemsNC=(fe.items||[]).map(i=>({...i,qty:parseFloat((i.qty*pct).toFixed(4)),subtotal:parseFloat(((i.subtotal||0)*pct).toFixed(5)),impuesto:parseFloat(((i.impuesto||0)*pct).toFixed(5)),totalLinea:parseFloat(((i.totalLinea||0)*pct).toFixed(5))}));
      totalGravado=parseFloat(((fe.totalGravado||0)*pct).toFixed(5));totalImpuesto=parseFloat(((fe.totalImpuesto||0)*pct).toFixed(5));totalVenta=parseFloat(((fe.totalVenta||0)*pct).toFixed(5));totalComprobante=parseFloat(montoNC.toFixed(5));
    }
    const fechaStr=`${fecha.getFullYear()}-${mes}-${dia}T${String(fecha.getHours()).padStart(2,'0')}:${String(fecha.getMinutes()).padStart(2,'0')}:${String(fecha.getSeconds()).padStart(2,'0')}-06:00`;
    const xmlNC=`<?xml version="1.0" encoding="UTF-8"?><NotaCreditoElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica"><Clave>${clave}</Clave><ProveedorSistemas>01</ProveedorSistemas><CodigoActividadEmisor>${(cfg.codigoActividad||"").replace(",","")}</CodigoActividadEmisor><NumeroConsecutivo>${consecutivo}</NumeroConsecutivo><FechaEmision>${fechaStr}</FechaEmision><Emisor><Nombre>${emisor.nombre}</Nombre><Identificacion><Tipo>${emisor.tipoId}</Tipo><Numero>${emisor.cedula.padStart(10,"0")}</Numero></Identificacion><Ubicacion><Provincia>${emisor.provincia}</Provincia><Canton>${emisor.canton}</Canton><Distrito>${emisor.distrito}</Distrito><OtrasSenas>${emisor.direccion}</OtrasSenas></Ubicacion><CorreoElectronico>${emisor.correo}</CorreoElectronico></Emisor>${fe.receptor?.nombre?`<Receptor><Nombre>${fe.receptor.nombre}</Nombre>${fe.receptor.cedula?`<Identificacion><Tipo>${fe.receptor.tipoId||'01'}</Tipo><Numero>${fe.receptor.cedula}</Numero></Identificacion>`:''}</Receptor>`:''}<CondicionVenta>01</CondicionVenta><MedioPago>${(fe.medioPago||['01'])[0]}</MedioPago><InformacionReferencia><TipoDoc>01</TipoDoc><Numero>${venta.facturaConsecutivo||fe.consecutivo}</Numero><FechaEmisionDoc>${fechaStr}</FechaEmisionDoc><Codigo>01</Codigo><Razon>${motivo.substring(0,180)}</Razon></InformacionReferencia><DetalleServicio>${itemsNC.map((item,i)=>`<LineaDetalle><NumeroLinea>${i+1}</NumeroLinea><CodigoCABYS>${item.codigoCABYS||"3835099010000"}</CodigoCABYS><Cantidad>${item.qty}</Cantidad><UnidadMedida>Unid</UnidadMedida><Detalle>${item.name.substring(0,200)}</Detalle><PrecioUnitario>${(item.precioUnitarioCRC||item.price||0).toFixed(5)}</PrecioUnitario><MontoTotal>${((item.precioUnitarioCRC||item.price||0)*item.qty).toFixed(5)}</MontoTotal><SubTotal>${(item.subtotal||0).toFixed(5)}</SubTotal>${(item.impuesto||0)>0?`<Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13.00</Tarifa><Monto>${(item.impuesto||0).toFixed(5)}</Monto></Impuesto>`:''}<MontoTotalLinea>${(item.totalLinea||0).toFixed(5)}</MontoTotalLinea></LineaDetalle>`).join('')}</DetalleServicio><ResumenFactura><TotalMercanciasGravadas>${totalGravado.toFixed(5)}</TotalMercanciasGravadas><TotalMercanciasExentas>0.00000</TotalMercanciasExentas><TotalGravado>${totalGravado.toFixed(5)}</TotalGravado><TotalExento>0.00000</TotalExento><TotalVenta>${totalVenta.toFixed(5)}</TotalVenta><TotalDescuentos>0.00000</TotalDescuentos><TotalVentaNeta>${totalVenta.toFixed(5)}</TotalVentaNeta><TotalImpuesto>${totalImpuesto.toFixed(5)}</TotalImpuesto><TotalComprobante>${totalComprobante.toFixed(5)}</TotalComprobante></ResumenFactura></NotaCreditoElectronica>`;
    const { firmarXML } = require('./signer');
    const p12Ref = storage.bucket().file(`llaves/${cfg.cedulaEmisor}/llave.p12`);
    const [p12Buffer] = await p12Ref.download();
    const xmlFirmadoBase64 = firmarXML(xmlNC, p12Buffer, cfg.pinLlave);
    const token = await obtenerToken({usuario:cfg.usuarioHacienda,password:cfg.passwordHacienda,ambiente});
    await enviarComprobante({xmlFirmadoBase64,clave,fecha:fecha.toISOString(),emisorTipo:emisor.tipoId,emisorCedula:emisor.cedula,receptorTipo:fe.receptor?.tipoId,receptorCedula:fe.receptor?.cedula,token,ambiente});
    const ncData={clave,consecutivo,fecha,ventaId,facturaId:venta.facturaId,facturaOriginalClave:venta.facturaClave,emisor,receptor:fe.receptor,items:itemsNC,totalGravado,totalImpuesto,totalVenta,totalComprobante,motivo,tipo,ambiente,estado:'procesando',xmlBase64:xmlFirmadoBase64,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:request.auth.uid};
    const ncRef = await db.collection('notascredito').add(ncData);
    const respuesta = await esperarRespuesta({clave,token,ambiente});
    await ncRef.update({estado:respuesta.estado,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    await db.collection('sales').doc(ventaId).update({notaCreditoId:ncRef.id,notaCreditoEstado:respuesta.estado});
    if (respuesta.estado==='aceptado' && fe.receptor?.correo) {
      await getTransporter().sendMail({from:`"${emisor.nombre}" <${getEmailConfig().user}>`,to:fe.receptor.correo,subject:`Nota de Crédito ${consecutivo} — ${emisor.nombre}`,html:`<div style="font-family:Arial,sans-serif"><div style="background:#dc2626;padding:20px;text-align:center"><h1 style="color:#fff;margin:0">Nota de Crédito Electrónica</h1></div><div style="padding:24px"><p>Adjunto su nota de crédito aceptada por Hacienda.</p><p><b>NC:</b> ${consecutivo}<br><b>Monto:</b> ₡#8353;${Math.round(totalComprobante).toLocaleString('es-CR')}<br><b>Motivo:</b> ${motivo}</p></div></div>`,attachments:[{filename:`NC_${consecutivo}.xml`,content:Buffer.from(xmlFirmadoBase64,'base64'),contentType:'application/xml'}]});
    }
    return {ok:true,ncId:ncRef.id,clave,consecutivo,estado:respuesta.estado,mensaje:respuesta.estado==='aceptado'?'Nota de crédito aceptada ✓':respuesta.estado==='rechazado'?'Rechazada: '+(respuesta.mensaje||''):'Enviada, procesando...'};
  } catch(e) { console.error('Error NC:',e); throw new HttpsError('internal',e.message); }
});

exports.emitirNotaCredito = onCall({ enforceAppCheck:false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
  const { ventaId, motivo, tipo, montoNC } = request.data;
  try {
    const ventaSnap = await db.collection('sales').doc(ventaId).get();
    if (!ventaSnap.exists) throw new Error('Venta no encontrada');
    const venta = ventaSnap.data();
    if (!venta.facturaId) throw new Error('Esta venta no tiene factura electrónica');
    const feSnap = await db.collection('facturas').doc(venta.facturaId).get();
    if (!feSnap.exists) throw new Error('Factura no encontrada');
    const fe = feSnap.data();
    if (fe.estado!=='aceptado') throw new Error('Solo se puede hacer NC de facturas aceptadas');
    const cfgSnap = await db.collection('config').doc('main').get();
    const cfg = cfgSnap.data();
    const ambiente = cfg.ambienteFE||'stag';
    const fecha = new Date();
    const contRef = db.collection('config').doc('consecutivoNC');
    const nuevoNum = await db.runTransaction(async t => {
      const snap = await t.get(contRef);
      const nuevo = (snap.exists?(snap.data().numero||0):0)+1;
      t.set(contRef,{numero:nuevo,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      return nuevo;
    });
    const dia=String(fecha.getDate()).padStart(2,'0');
    const mes=String(fecha.getMonth()+1).padStart(2,'0');
    const anio=String(fecha.getFullYear()).slice(-2);
    const cedula=cfg.cedulaEmisor.padStart(12,'0');
    const seg=Math.floor(Math.random()*99999999).toString().padStart(8,'0');
    const clave=`506${dia}${mes}${anio}${cedula}${nuevoNum.toString().padStart(10,'0')}05${seg}`;
    const consecutivo=`001000010500${nuevoNum.toString().padStart(10,'0')}`;
    const emisor={nombre:fe.emisor.nombre,cedula:cfg.cedulaEmisor,tipoId:cfg.tipoIdEmisor||cfg.tipoIdentificacion||'01',correo:cfg.correoEmisor,codigoActividad:(cfg.codigoActividad||"").replace(",",""),provincia:cfg.provincia||'5',canton:cfg.canton||'03',distrito:cfg.distrito||'01',direccion:cfg.address||'Guanacaste'};
    let itemsNC,totalGravado,totalImpuesto,totalVenta,totalComprobante;
    if (tipo==='total') {
      itemsNC=fe.items||[];totalGravado=fe.totalGravado||0;totalImpuesto=fe.totalImpuesto||0;totalVenta=fe.totalVenta||0;totalComprobante=fe.totalComprobante||0;
    } else {
      const pct=montoNC/fe.totalComprobante;
      itemsNC=(fe.items||[]).map(i=>({...i,qty:parseFloat((i.qty*pct).toFixed(4)),subtotal:parseFloat(((i.subtotal||0)*pct).toFixed(5)),impuesto:parseFloat(((i.impuesto||0)*pct).toFixed(5)),totalLinea:parseFloat(((i.totalLinea||0)*pct).toFixed(5))}));
      totalGravado=parseFloat(((fe.totalGravado||0)*pct).toFixed(5));totalImpuesto=parseFloat(((fe.totalImpuesto||0)*pct).toFixed(5));totalVenta=parseFloat(((fe.totalVenta||0)*pct).toFixed(5));totalComprobante=parseFloat(montoNC.toFixed(5));
    }
    const fechaStr=`${fecha.getFullYear()}-${mes}-${dia}T${String(fecha.getHours()).padStart(2,'0')}:${String(fecha.getMinutes()).padStart(2,'0')}:${String(fecha.getSeconds()).padStart(2,'0')}-06:00`;
    const xmlNC=`<?xml version="1.0" encoding="UTF-8"?><NotaCreditoElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica"><Clave>${clave}</Clave><ProveedorSistemas>01</ProveedorSistemas><CodigoActividadEmisor>${(cfg.codigoActividad||"").replace(",","")}</CodigoActividadEmisor><NumeroConsecutivo>${consecutivo}</NumeroConsecutivo><FechaEmision>${fechaStr}</FechaEmision><Emisor><Nombre>${emisor.nombre}</Nombre><Identificacion><Tipo>${emisor.tipoId}</Tipo><Numero>${emisor.cedula.padStart(10,"0")}</Numero></Identificacion><Ubicacion><Provincia>${emisor.provincia}</Provincia><Canton>${emisor.canton}</Canton><Distrito>${emisor.distrito}</Distrito><OtrasSenas>${emisor.direccion}</OtrasSenas></Ubicacion><CorreoElectronico>${emisor.correo}</CorreoElectronico></Emisor>${fe.receptor?.nombre?`<Receptor><Nombre>${fe.receptor.nombre}</Nombre>${fe.receptor.cedula?`<Identificacion><Tipo>${fe.receptor.tipoId||'01'}</Tipo><Numero>${fe.receptor.cedula}</Numero></Identificacion>`:''}</Receptor>`:''}<CondicionVenta>01</CondicionVenta><MedioPago>${(fe.medioPago||['01'])[0]}</MedioPago><InformacionReferencia><TipoDoc>01</TipoDoc><Numero>${venta.facturaConsecutivo||fe.consecutivo}</Numero><FechaEmisionDoc>${fechaStr}</FechaEmisionDoc><Codigo>01</Codigo><Razon>${motivo.substring(0,180)}</Razon></InformacionReferencia><DetalleServicio>${itemsNC.map((item,i)=>`<LineaDetalle><NumeroLinea>${i+1}</NumeroLinea><CodigoCABYS>${item.codigoCABYS||"3835099010000"}</CodigoCABYS><Cantidad>${item.qty}</Cantidad><UnidadMedida>Unid</UnidadMedida><Detalle>${item.name.substring(0,200)}</Detalle><PrecioUnitario>${(item.precioUnitarioCRC||item.price||0).toFixed(5)}</PrecioUnitario><MontoTotal>${((item.precioUnitarioCRC||item.price||0)*item.qty).toFixed(5)}</MontoTotal><SubTotal>${(item.subtotal||0).toFixed(5)}</SubTotal>${(item.impuesto||0)>0?`<Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13.00</Tarifa><Monto>${(item.impuesto||0).toFixed(5)}</Monto></Impuesto>`:''}<MontoTotalLinea>${(item.totalLinea||0).toFixed(5)}</MontoTotalLinea></LineaDetalle>`).join('')}</DetalleServicio><ResumenFactura><TotalMercanciasGravadas>${totalGravado.toFixed(5)}</TotalMercanciasGravadas><TotalMercanciasExentas>0.00000</TotalMercanciasExentas><TotalGravado>${totalGravado.toFixed(5)}</TotalGravado><TotalExento>0.00000</TotalExento><TotalVenta>${totalVenta.toFixed(5)}</TotalVenta><TotalDescuentos>0.00000</TotalDescuentos><TotalVentaNeta>${totalVenta.toFixed(5)}</TotalVentaNeta><TotalImpuesto>${totalImpuesto.toFixed(5)}</TotalImpuesto><TotalComprobante>${totalComprobante.toFixed(5)}</TotalComprobante></ResumenFactura></NotaCreditoElectronica>`;
    const { firmarXML } = require('./signer');
    const p12Ref = storage.bucket().file(`llaves/${cfg.cedulaEmisor}/llave.p12`);
    const [p12Buffer] = await p12Ref.download();
    const xmlFirmadoBase64 = firmarXML(xmlNC, p12Buffer, cfg.pinLlave);
    const token = await obtenerToken({usuario:cfg.usuarioHacienda,password:cfg.passwordHacienda,ambiente});
    await enviarComprobante({xmlFirmadoBase64,clave,fecha:fecha.toISOString(),emisorTipo:emisor.tipoId,emisorCedula:emisor.cedula,receptorTipo:fe.receptor?.tipoId,receptorCedula:fe.receptor?.cedula,token,ambiente});
    const ncData={clave,consecutivo,fecha,ventaId,facturaId:venta.facturaId,facturaOriginalClave:venta.facturaClave,emisor,receptor:fe.receptor,items:itemsNC,totalGravado,totalImpuesto,totalVenta,totalComprobante,motivo,tipo,ambiente,estado:'procesando',xmlBase64:xmlFirmadoBase64,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:request.auth.uid};
    const ncRef = await db.collection('notascredito').add(ncData);
    const respuesta = await esperarRespuesta({clave,token,ambiente});
    await ncRef.update({estado:respuesta.estado,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    await db.collection('sales').doc(ventaId).update({notaCreditoId:ncRef.id,notaCreditoEstado:respuesta.estado});
    if (respuesta.estado==='aceptado' && fe.receptor?.correo) {
      await getTransporter().sendMail({from:`"${emisor.nombre}" <${getEmailConfig().user}>`,to:fe.receptor.correo,subject:`Nota de Crédito ${consecutivo} — ${emisor.nombre}`,html:`<div style="font-family:Arial,sans-serif"><div style="background:#dc2626;padding:20px;text-align:center"><h1 style="color:#fff;margin:0">Nota de Crédito Electrónica</h1></div><div style="padding:24px"><p>Adjunto su nota de crédito aceptada por Hacienda.</p><p><b>NC:</b> ${consecutivo}<br><b>Monto:</b> ₡#8353;${Math.round(totalComprobante).toLocaleString('es-CR')}<br><b>Motivo:</b> ${motivo}</p></div></div>`,attachments:[{filename:`NC_${consecutivo}.xml`,content:Buffer.from(xmlFirmadoBase64,'base64'),contentType:'application/xml'}]});
    }
    return {ok:true,ncId:ncRef.id,clave,consecutivo,estado:respuesta.estado,mensaje:respuesta.estado==='aceptado'?'Nota de crédito aceptada ✓':respuesta.estado==='rechazado'?'Rechazada: '+(respuesta.mensaje||''):'Enviada, procesando...'};
  } catch(e) { console.error('Error NC:',e); throw new HttpsError('internal',e.message); }
});
exports.emitirNotaCredito = require('./ncFunction').addNC(onCall, HttpsError, db, storage, obtenerToken, enviarComprobante, esperarRespuesta, require('./signer').firmarXML, getTransporter, getEmailConfig, admin);
exports.emitirNotaCredito = require('./ncFunction').addNC(onCall, HttpsError, db, storage, obtenerToken, enviarComprobante, esperarRespuesta, require('./signer').firmarXML, getTransporter, getEmailConfig, admin);
